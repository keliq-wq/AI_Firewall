# 不变量说明书(INVARIANTS)

> 效果收集器(`src/effects/collector.ts`)把模拟响应变成协议无关的"事实";不变量引擎(`src/invariants/engine.ts`)对事实做安全判定。本文件描述 Layer 2 的判定核心——I1/I2/I4/C1 四条不变量、drainer 攻击映射、已知盲区与验收指标。
>
> 总原则(信封纪律,**src/gates/envelope.ts:8-19**):**效果 ⊆ 信封 ⊆ 策略上限**。模拟出的真实效果是事实;Agent 声明只是上限,永远不能突破策略。判定方向:声明永不当事实,只作上限。

## 0. 不变量一览

| 不变量 | 一句话定义 | severity | 判定对象 | 引擎实现 |
|---|---|---|---|---|
| **I1 每资产净流出上界** | 钱包的代币余额下降在无逐资产声明信封时必须记为净流出(当前 API 无逐资产声明,任何代币净流出即违规) | high | 代币账户 amount delta | `src/invariants/engine.ts:64-77` |
| **I2 权限零突变** | 资金控制权字段(delegate / delegatedAmount / closeAuthority / 冻结态)不得发生任何突变,出现即视为控制权变更 | high(冻结 medium) | delegate/closeAuthority/state 前后态差异 | `src/invariants/engine.ts:31-62` |
| **I4 敏感指令(顶层+内层)** | Approve/SetAuthority/CloseAccount 无论出现在顶层还是 CPI 深层转发都必须被识别 | high | 顶层指令解析 + innerInstructions 扫描 | `src/invariants/engine.ts:79-87`(内层);顶层见 §3 |
| **C1 覆盖完整性** | 响应截断或前态缺失时,缺失**不得**被当作"无变化",必须 fail-closed 记为覆盖缺口 | high(截断)/medium(前态缺失) | 请求-响应对账 + 前态完整性 | `src/invariants/engine.ts:89-102` |

引擎头的四条设计说明见 `src/invariants/engine.ts:3-13`。

### 严重度 → 判定 → 升级分级(所有不变量共用)

| severity | strict 模式 | monitor 模式 | 升级分级(tier) |
|---|---|---|---|
| critical | deny | deny | deny |
| high | deny | escalate(人工确认) | confirm |
| medium | escalate | escalate | notice |
| low | allow(仅记录) | allow | info |

- 映射实现:`src/gates/util.ts:18-29`(`verdictForSeverity`)、`src/gates/util.ts:38-49`(`tierForSeverity`)。
- 总体拒绝时 tier 一律 deny;tier 由最高严重度关切推导:`src/validate.ts:87-89`。
- 不变量违规在结果里以 `INV_<不变量>` 为 id 出现(如 `INV_I2`):`src/validate.ts:122`。
- 不变量门(GateName=`invariants`)只对 **V0 交易 + 配置了 RPC connection** 启用:`src/validate.ts:70-72`。

---

## 1. I1 — 每资产净流出上界

**定义**:钱包声明的代币账户余额下降,在缺少逐资产声明信封时一律记为高严重度净流出违规(`UNDECLARED_TOKEN_OUTFLOW` 语义)。

**severity**:high(`src/invariants/engine.ts:70-71`)→ strict deny / monitor escalate。

**判据(实际代码)**:对效果报告里的每个代币账户 delta,取 `amountDelta < 0n` 且账户归钱包者(未声明 wallet 时不过滤):

- 收集:`src/effects/collector.ts:176-189`(amountDelta 在 `:182`);SOL 维度的 lamports delta 收集在 `src/effects/collector.ts:159-161`。
- 判定:`src/invariants/engine.ts:64-77`(合并所有净流出 mint 并附明细)。

**SOL 维度的同一上界在哪里判**:代币之外,SOL 净流出由两门承载——
- 离线信封门:解析出 wallet 的转出总额 vs 声明,`UNDECLARED_OUTFLOW`(high,`src/gates/envelope.ts:46-47`)、`AMOUNT_EXCEEDS_ENVELOPE`(high,`src/gates/envelope.ts:53-54`);
- 模拟门:模拟出的钱包净流出 vs 声明(含手续费容差,默认 0.05 SOL,`src/policy.ts:40`),`UNEXPECTED_DRAIN`(high,`src/gates/simulation.ts:74-75`)、未声明且有流出 → `UNDECLARED_OUTFLOW`(high,`src/gates/simulation.ts:89-90`)。

**攻击向量映射**:
- 恶意 swap / 转账欺诈:Agent 声称"领空投",实际交易把代币转给攻击者——净流出在模拟效果里无法隐藏;
- I2 授权盗取的**后半段**:攻击者拿到 delegate 后发起的盗取转账,在盗取交易本身以 I1 净流出命中;
- 非零余额 CloseAccount 清扫的余额外流(I1 侧)。

**误伤(FP)分析**:
- **任何合法代币支付/swap 卖出都会命中**:当前 API 没有逐资产声明能力(见 `src/invariants/engine.ts:6-8` 的注释),所以"合法代币流出"与"被盗代币流出"在 I1 眼里同样 high。设计取舍是"先拦后确认",但这是告警疲劳的第一大来源(见 §7)。
- **钱包未声明时归属过宽**:`!wallet ||` 分支(`src/invariants/engine.ts:66`)使任意账户的代币净流出都会被记录,包括与钱包无关的中间账户。
- **自有账户间搬移**:同一钱包名下两个代币账户互转时,转出账户记 -N 即触发 high(逐账户判定,不做同 mint 净额抵消)。
- SOL 维度:合法转账超过声明即 deny 是预期行为;边界 FP 是"未声明金额 + 仅手续费流出"——容差(默认 0.05 SOL)覆盖普通手续费,但极端拥堵下的优先费可能超过容差。

**实现与测试**:
- 实现:`src/invariants/engine.ts:64-77`、`src/effects/collector.ts:159-161,176-189`;SOL 侧 `src/gates/envelope.ts:36-59`、`src/gates/simulation.ts:61-95`。
- 测试:`tests/effects-invariants.test.ts:115`「提取代币余额 delta 与 Approve 突变(I2)」(断言 `:153` amountDelta=-10n、`:158` I1 命中);`tests/envelope.test.ts:13`「旗舰场景:声明 0.002 实转 0.04 → deny(AMOUNT_EXCEEDS_ENVELOPE)」;`tests/envelope.test.ts:41`「有转出但无声明 → deny(UNDECLARED_OUTFLOW)」;`tests/simulation.test.ts:155`「净流出超出声明金额 + 容差 → UNEXPECTED_DRAIN deny」。

---

## 2. I2 — 权限零突变

**定义**:钱包代币账户的资金控制权字段(delegate 出现/更换、delegatedAmount 增加、closeAuthority 变更、冻结状态变化)在模拟前后不得发生任何突变——突变即资金控制权变更。

**severity**:Approve 突变 high、closeAuthority 变更 high、冻结态变化 medium(`src/invariants/engine.ts:34,49,57`)。

**判据(实际代码)**:
- 事实提取(对 165B Token 账户固定布局解码,`src/decode/token_layout.ts:46-66`,字段偏移注释 `:48-50`):
  - `delegateChanged`:前后态 delegate 不同(含 Some→None),`src/effects/collector.ts:173`;
  - `approveDetected` = delegateChanged **或** delegatedAmount 增加,`src/effects/collector.ts:174-175`;
  - `closeAuthorityChanged`,`src/effects/collector.ts:185-187`;`frozenChanged`(state 1↔2),`src/effects/collector.ts:188`。
- 判定:`src/invariants/engine.ts:31-62`(三条分别 push)。

**攻击向量映射**:
- **Approve 无限授权盗取**:攻击者诱导 Agent 签署 Approve(delegate=攻击者,amount=u64::MAX)→ 此后攻击者可随时转走余额。I2 消息明确标注 "delegated authority can drain the balance"(`src/invariants/engine.ts:36`)。顶层离线识别见 `TOKEN_APPROVE`(high,`src/gates/credibility.ts:83-84`)。
- **closeAuthority 篡改**:把关闭权限改到攻击者,随后 CloseAccount 把账户余额与租金一起卷走(`src/invariants/engine.ts:46-53`)。
- **delegate 更换**:把既有授权从旧受托方改到攻击者,同样是控制权转移。
- **冻结**:冻结他人代币账户(DoS / 赎金场景)表现为控制权变更(medium)。

**误伤(FP)分析**:
- **同笔交易内的"授权+消费"委托流**:部分 DEX/代付协议先 Approve 再由 CPI 消费;终态即使 delegatedAmount 归零,delegate 字段残留也会被 `delegateChanged` 命中 → high。
- **撤销授权(Revoke)也被报**:Revoke 把 delegate 从 Some→None,`preDelegate !== postDelegate` 成立 → `approveDetected=true`(方向性上把"减少授权"也当作突变)。这是已知的方向性误报,后续可区分"授权增加/减少"。
- **协议托管设置 closeAuthority**(托管方案、wrapped/临时账户管理)会命中 high。
- 冻结状态变化(medium)在合规冻结/解冻流程中会 escalate。
- 这四类都是"效果真阳性、意图假阳性":效果层如实报告了控制权变化,但是否为攻击意图需要人工确认(strict 下直接 deny 是刻意保守)。

**实现与测试**:
- 实现:`src/invariants/engine.ts:31-62`、`src/effects/collector.ts:171-188`、`src/decode/token_layout.ts:51,58,60,62-63`。
- 测试:`tests/effects-invariants.test.ts:115`(断言 `:154` approveDetected、`:157` I2 消息含 "approval");`tests/effects-invariants.test.ts:192`「V0 交易 + Approve 突变 → INV_I2 deny」(`:228` 断言 `INV_I2`);`tests/token-ops.test.ts:56`「Approve(4):识别为代币授权操作并归入敏感类别」(`:63` 构造 u64::MAX 无限授权)。

---

## 3. I4 — 敏感指令(顶层 + 内层)

**定义**:Approve(4)/SetAuthority(6)/CloseAccount(9) 这三个敏感 token 指令,无论出现在交易顶层还是 CPI 深层转发,都必须被识别并标记为敏感。

**severity**:high(`src/invariants/engine.ts:82-83`)。

**判据(实际代码,分两半)**:
- **内层(CPI)**:效果收集器扫描模拟响应的 `innerInstructions`,当内层指令的 program 是 Token/Token-2022 且 `data[0] ∈ {4,6,9}` 时命中:标签集合 `src/effects/collector.ts:23`(程序集合 `:19-22`),扫描实现 `src/effects/collector.ts:71-96`(命中 push 在 `:91-92`);V0 分支 `:98-118`。引擎侧 push:`src/invariants/engine.ts:79-87`(tag 名词映射 `:21-25`)。
- **顶层(离线)**:解析器手动解码 Token 指令——Approve `src/parser.ts:282-293`、SetAuthority `:300-305`、CloseAccount `:306-311`(布局对照注释 `:242-251`);credibility 门把三类操作升级为关切:`TOKEN_APPROVE`(high,`src/gates/credibility.ts:83-84`)、`TOKEN_SET_AUTHORITY`(high,`:90-91`)、`TOKEN_CLOSE_ACCOUNT`(high,`:97-98`,消息明确提示 "verify balance is zero or intended")。
- **覆盖边界**:顶层半区对 legacy/V0 都生效(离线解析无需 RPC);内层半区只有 **V0 + connection** 启用(不变量门接线条件 `src/validate.ts:70-72`),legacy 无 CPI 可见性(见 §6)。

**攻击向量映射**:
- drainer 把 Approve/SetAuthority/CloseAccount 藏进 CPI 内层,规避只扫顶层指令的静态分析——内层扫描使"藏多深都可见"(`src/effects/collector.ts:74` 注释)。
- 内层 Approve 同时触发 I2(delegate 突变)与 I4,双保险。
- 顶层 CloseAccount 清扫:credibility 门在签名前拦截;内层 CloseAccount 由 I4 拦截。

**误伤(FP)分析**:
- **wrapped SOL 回收是最常见的内层 CloseAccount**:几乎所有涉及 SOL 的 swap 都会创建临时 wSOL 账户,完成后用 CloseAccount(tag 9)回收租金 → 在严格模式下每一笔此类交易都会被 I4 标 high。这是 I4 第一大 FP 源。
- 协议内部授权中转(聚合器/代付)在 CPI 内 Approve 也会命中。
- Token-2022 基础指令标签与 Token 相同(解码取 `data[0]`),扩展指令前缀不会误判为敏感 tag。

**实现与测试**:
- 实现:`src/effects/collector.ts:23,71-96`;`src/invariants/engine.ts:79-87`;顶层 `src/parser.ts:252-318` + `src/gates/credibility.ts:80-110`。
- 测试:`tests/effects-invariants.test.ts:115`(假 RPC 构造内层 Approve,inner 数据见 `:53-62`;断言 `:159` I4);`tests/token-ops.test.ts:72`「SetAuthority(6)/CloseAccount(9) 被识别」。

---

## 4. C1 — 覆盖完整性

**定义**:模拟响应必须完整覆盖请求的账户;响应截断或前态缺失时,缺口不得被当作"无变化",一律 fail-closed 记为覆盖缺口。

**severity**:truncated=high(`src/invariants/engine.ts:92-93`);missing-pre=medium(`src/invariants/engine.ts:98-99`)。

**判据(实际代码)**:
- **请求-响应对账**:V0 分块模拟(每块 ≤4 个地址,`src/effects/collector.ts:50`),每块检查"返回条数 < 请求条数"即 truncated——"少一条都要 fail-closed"(`src/effects/collector.ts:113`;分块循环 `:98-118`)。
- **前态完整性**:前态经 `getMultipleAccountsInfo` 重试(最多 4 次,2/4/6/8 秒退避),最终仍缺失 → missing-pre(`src/effects/collector.ts:136-143`,置位在 `:143`)。
- **判定**:`completeness` 字段(`src/effects/collector.ts:41-42`)→ 引擎 push(`src/invariants/engine.ts:89-102`)。
- 幽灵账户(模拟未返回)在事实提取阶段直接跳过(`src/effects/collector.ts:154`)——这正是"补全对账前不得静默"的原因。

**攻击向量映射**:
- 攻击者/劣质 RPC 制造"响应被截断",让部分账户变化不可见,诱导上层把缺失当"无变化"放行;C1 使缺失本身变成 high 违规。
- 多节点端点前态滞后:同一批账户从不同节点读数,delta 可能失真;missing-pre 明示"deltas may be unreliable"(`src/invariants/engine.ts:100`)。

**误伤(FP)分析**:
- **本笔新建账户必然触发 missing-pre**:首次创建 ATA / 新账户在链上不存在前态,`getMultipleAccountsInfo` 返回 null → missing-pre(medium → escalate),且触发全部 4 次重试退避。`tests/effects-invariants.test.ts:162` 在幽灵账户场景下实测约 20 秒(本机 vitest 运行时长),即每笔触达新建账户的合法交易都要付出这个延迟代价。这是 C1 的主要 FP,建议后续对"交易内新建账户"做豁免识别。
- truncated 属于真基础设施异常,FP 低。
- 语义上 C1 是刻意保守:"拿不到就升级人工",不是错误。

**实现与测试**:
- 实现:`src/effects/collector.ts:41-42,50,98-118,136-143`;`src/invariants/engine.ts:89-102`。
- 测试:`tests/effects-invariants.test.ts:233`「C1 截断 → high 违规」(`:243` 断言);`tests/effects-invariants.test.ts:162`「幽灵地址与响应截断 → C1 fail-closed」(`:187` 断言 completeness 非 complete);`tests/effects-invariants.test.ts:246`「无事实 → 零违规」(阴性对照)。

---

## 5. drainer 攻击类别 → 不变量 → 测试 映射表

| # | drainer 攻击类别 | 触发的不变量/判定 | 实现(file:line) | 测试(file:line · 测试名) |
|---|---|---|---|---|
| 1 | **转账欺诈**(声明金额 ≠ 实际转出 / 未声明) | I1(净流出上界;SOL 侧由信封门 + 模拟门承载) | `src/gates/envelope.ts:36-59`;`src/gates/simulation.ts:61-95` | `tests/envelope.test.ts:13` 旗舰场景;`tests/simulation.test.ts:155` UNEXPECTED_DRAIN;`tests/simulation.test.ts:173` UNDECLARED_OUTFLOW |
| 2 | **Approve 无限授权**(授权后盗取) | I2(delegate/delegatedAmount 突变) + 顶层 `TOKEN_APPROVE` + 内层 I4 | `src/invariants/engine.ts:31-45`;`src/effects/collector.ts:171-175`;`src/gates/credibility.ts:83-84`;`src/parser.ts:282-293` | `tests/token-ops.test.ts:56`(u64::MAX 构造 `:63`);`tests/effects-invariants.test.ts:115`;`tests/effects-invariants.test.ts:192` INV_I2 deny |
| 3 | **SetAuthority 权限转移** | I2(closeAuthority 字段) + 顶层 `TOKEN_SET_AUTHORITY` + 内层 I4(tag 6) | `src/invariants/engine.ts:46-53`;`src/gates/credibility.ts:90-91`;`src/parser.ts:300-305` | `tests/token-ops.test.ts:72` SetAuthority(6)/CloseAccount(9) 被识别 |
| 4 | **非零余额 CloseAccount 清扫**(关户卷走余额) | I4(tag 9 敏感,顶层 + 内层) + I1(余额外流侧) | `src/gates/credibility.ts:97-98`(消息要求核对余额是否为零);`src/parser.ts:306-311`;`src/effects/collector.ts:23` + `src/invariants/engine.ts:79-87` | `tests/token-ops.test.ts:72`(识别);`tests/effects-invariants.test.ts:158`(I1 净流出断言)。**注**:被关闭账户若不再出现在模拟响应里(post 为空),效果层会直接跳过(`src/effects/collector.ts:154`);余额清扫主要靠 CloseAccount 命中 + 人工核对,尚无专门案例测试(待补) |
| 5 | **owner 改向**(账户控制权转移) | I2 族(资金控制权变更):离线 `OWNER_CHANGE` / 模拟 `OWNER_CHANGE_SIMULATED`(critical) | `src/gates/credibility.ts:44-77`;`src/parser.ts:191-234`;`src/gates/simulation.ts:37-50` | `tests/token-ops.test.ts:116` assign 高危拦截;`tests/credibility.test.ts:14`;`tests/simulation.test.ts:118` CPI 层 owner 变更 critical deny |
| 6 | **费用吸干**(隐藏扣费/净流出超声明) | I1(SOL 侧:净流出 vs 声明 + 容差) | `src/gates/simulation.ts:64-95`;`src/policy.ts:40`(默认容差 0.05 SOL) | `tests/simulation.test.ts:189` 仅手续费流出(容差内)放行;`tests/simulation.test.ts:155` |
| 7 | **多收款方拆分**(分拆绕过单笔/日限额) | I1(单笔内多转出求和)+ 24h 滚动累积(指纹键,不按收款方分桶) | `src/gates/envelope.ts:39-40`;`src/gates/limits.ts:46-52,82-94`;`src/accounting.ts:31-54,70-98` | `tests/accounting.test.ts:31` 绕过 2(同收款方不同交易累积);`tests/accounting.test.ts:66` 绕过 3;`tests/limits.test.ts:43` DAILY_LIMIT_EXCEEDED |
| 8 | **ALT 隐匿**(地址查找表藏程序/账户) | C1 族(覆盖完整性:程序集不完整则无法完整校验) | `src/gates/credibility.ts:20-27`(`ALT_UNRESOLVED`,medium);`src/parser.ts:117-121,126-131` | **无稳定回归测试**。一次性探针 `tests/__refuter-alt-probe.tmp.test.ts:59-63` 已验证 `parsed.unresolvedLookups=true`;该文件被 `.gitignore`(`*.tmp.*`)排除,Phase 2 反转为验收测试后入库(见 §6) |
| 9 | **CPI 深层转发敏感指令**(Approve/SetAuthority/CloseAccount 藏在内层) | I4(内层 tag 4/6/9)+ I2(内层突变)+ 模拟门 CPI owner 变更 | `src/effects/collector.ts:71-96`;`src/invariants/engine.ts:79-87`;`src/gates/simulation.ts:37-50` | `tests/effects-invariants.test.ts:115`(内层 Approve 构造 `:53-62`,断言 `:159`);`tests/simulation.test.ts:118` |

---

## 6. 已知盲区(诚实声明)

1. **价值公平性**:引擎只比较数量(amount delta / lamports delta),没有价格预言机或参考汇率——"1 SOL 换 1 USDC"与"1 SOL 全额转给攻击者"在 I1 眼里同样是净流出;"合法交易"是否等价交换,不在判定范围。
2. **协议内状态语义**:效果层只看 SPL Token 165B 固定布局(`src/decode/token_layout.ts:46-66`)与账户 lamports;协议自有状态(借贷仓位、LP/质押凭证、Unstake 队列、限价单、权限 PDA)发生变化时不可见。资金"流入"恶意合约被锁死这类损失,只能看到 outflow 方向,看不到换回的权益是否等值、能否赎回。
3. **TOCTOU(模拟-执行时间差)**:`simulateTransaction` 与签名/上链之间存在窗口;前态还来自多节点重试(`src/effects/collector.ts:136-143`),读数可能来自不同节点/槽位。攻击者可构造依赖链上状态瞬时变化(闪电贷、预言机操纵)的交易,模拟态 ≠ 执行态。**模拟通过不等于上链安全**,最终保证在 Layer 3 链上金库的程序内状态机。
4. **legacy 无 CPI 可见性**:legacy 路径单次模拟、无 addresses 分块、不索取内层指令保证(`src/effects/collector.ts:119-133`);不变量引擎只对 V0 启用(`src/validate.ts:70-72`)。legacy 的完整性对账也弱化:truncated 判定以 `accounts` 为 null 为条件,而取值时已兜底为空数组(`src/effects/collector.ts:127-128`),实际主要靠 missing-pre 兜底。legacy 的顶层敏感指令仍有 credibility 离线覆盖,内层 CPI 则无。
5. **归属边界**:未声明 wallet 时 I1 归属过宽(任意账户净流出都记录,`src/invariants/engine.ts:66`);声明 wallet 时只认"token 账户 owner 字段 = wallet",钱包经手的中间账户/PDA 不归因。SOL 侧信封门只统计解析出的顶层转出(`from === wallet`,`src/gates/envelope.ts:39`),CPI 内层转账不在其中(模拟门的账户级净流出可补位,但依赖 V0)。
6. **数量语义**:只报 raw u64 数量(`src/effects/collector.ts:182`),无 mint decimals 折算——无法区分 1000 raw 单位的价值;且按账户而非按 mint 聚合,自有账户间搬移会各记一笔(见 §1 FP)。

---

## 7. 验收标准:升级占比(escalationRate)作为告警疲劳指标

**指标定义与获取**(`src/validate.ts:107-115`):
- `escalationRate = escalations / validations`(`:112`);`escalations` 只统计总体判定为 escalate 的笔数(`:94`),**deny 不计入**——deny 是明确拦截,不是人工负担;
- `tiers` 分布 `{info, notice, confirm, deny}`(`:93`,类型定义 `src/types.ts:85-86`),提供比单一比率更细的定位;
- 暴露面:聚合统计走 `Firewall.stats`(TypeScript)与 `getFirewallStats`(solana-agent-kit 插件,`src/agent-kit.ts:43`);单笔结果本身带 `tier` 字段(`ValidationResult`,`src/types.ts:88-96`,MCP `validate_transaction` 原样返回)。

**为什么用它**:防火墙的失效模式不是"漏报"而是"误报把人累死"——升级占比过高时用户会开始无脑点确认,防火墙形同虚设。escalationRate 就是"人工确认负载"的代理指标;tier 分布进一步定位来源(如 `notice`/`confirm` 占比高,说明 medium/high 级 FP 泛滥,I2/I4 的 wrapped-SOL 与委托流、C1 的新建账户是已知主 FP 源,见 §1-§4)。

**建议验收基线**(工程建议,非代码内已有数值,待真实流量校准):

| 区间 | 判定 | 行动 |
|---|---|---|
| < 5% | 健康 | 稳定运行 |
| 5% - 15% | 观察 | 按 tier 分布定位 FP 源,收窄或提供豁免通道 |
| > 15% | 告警疲劳 | 先修 FP 再放量;否则人工确认通道会失去意义 |

补充:deny 占比在有真实攻击流量时应 > 0;长期为 0 需要检查不变量是否被绕过(而非庆祝)。

**支撑设施与回归**:
- 交易内容指纹(同笔重试可聚合审计):`src/validate.ts:100`;`src/accounting.ts:31-54`;测试 `tests/tier.test.ts:53`「同交易两次校验 → 指纹一致」;
- 分级派生(high→confirm、medium→notice、critical→deny):`src/gates/util.ts:38-49`;测试 `tests/tier.test.ts:39`「monitor 模式高危 → tier=confirm + requiresConfirmation」;
- 统计累进:测试 `tests/tier.test.ts:68`「升级占比统计(stats)累进」;
- 分级叙述头:zh/en 输出带 `【已拦截 · 拒绝】` 等分级标签(`src/narrator.ts:19-25,41-47`)。

---

## 附:复现与验证

- 全套单测:`npm test` —— 本机(2026-10-10)12 个文件、58 个测试全部通过,其中不变量相关回归见 `tests/effects-invariants.test.ts`(5 项)。
- 真实 RPC 端到端(纯模拟、零资金消耗):`scripts/inv-live-check.ts`——对钱包名下真实代币账户构造 Approve 无限授权 V0 交易,断言效果收集器提取 delegate 突变 → I2 拦截,并对无权限突变的对照指令断言零 I2/I4 违规(过滤条件见脚本 `:108`)。该脚本已在真实 testnet RPC 上跑通(git 提交 `7a2b085`)。
