# Threat Model(威胁模型)

> 防火墙存在的全部理由。每一层防御都对应具体的攻击向量;每一行代码都能回溯到这张表。

## 攻击向量 → 防御映射

| # | 攻击向量 | 场景 | 防御层 | 机制 |
|---|---|---|---|---|
| T1 | **提示注入** | 网页/文档中藏恶意指令,诱导 Agent 发起转账 | Layer 1 worth 门 | 敏感操作必须声明业务理由;超额触发人工确认阈值 |
| T2 | **Owner 权限钓鱼**(Solana 特有) | 诱导签名"免费空投"交易,实际把账户 owner 转移给恶意程序,永久失去控制权 | Layer 1 credibility 门 + Layer 2 模拟 | 静态解析顶层指令的 assign;模拟执行揭示 CPI 内层 owner 变更(critical 一律拒绝) |
| T3 | **伪造声明金额(静默 drain)** | Agent 声明小额意图,交易代码实际转出大额 | Layer 2 simulation 门 | 模拟执行的净流出与声明金额比对,超出容差 → UNEXPECTED_DRAIN 拒绝 |
| T4 | **调用恶意/未知协议** | 诱导 Agent 与 rug/scam 程序交互 | Layer 1 credibility + avoidance 门 | 协议白名单 + 黑名单,双门拦截 |
| T5 | **超额/高频支出** | 一次性大额转账,或 24h 内多笔累积超限 | Layer 1 limits 门 + Layer 3 链上窗口 | 单笔上限;24h 滚动支出(内存版;链上版用 Clock 滚动窗口) |
| T6 | **Agent 私钥泄露** | 攻击者拿到私钥,绕过一切客户端检查直接构造交易 | Layer 3 链上金库 | 资金在 PDA 金库,Agent 密钥对金库零权限;支出必须通过链上身份/限额/白名单/窗口检查 |
| T7 | **转款到合约地址** | 资金"转入"恶意合约被锁死 | Layer 3 withdraw | 收款方必须是 System 拥有的普通钱包(DestinationNotWallet) |
| T8 | **CPI 内层隐藏的敏感 token 指令** | Approve/SetAuthority/CloseAccount 被协议通过 CPI 转发,顶层静态分析看不到;攻击者借"正常协议调用"掩盖权限变更 | Layer 2 不变量引擎(I4) | 效果收集器在内层指令扫描(innerInstructions)中按首字节识别 tag(4/6/9)、校验 program ∈ Tokenkeg/Token-2022;命中即 I4 high——顶层不可见的内层操作现形 |
| T9 | **代币无限授权盗取** | 诱导签名 Approve 把 delegate 额度开到 u64::MAX,随后攻击者清扫账户全部余额 | Layer 2 不变量引擎(I2) | 模拟事实比对(非声明意图):前态/后态 165B 代币账户解码,delegate 出现/更换或 delegatedAmount 增加即判定 Approve,I2 high |
| T10 | **未声明的代币净流出** | swap 等交易把钱包代币换走,信封未声明该资产,价值静默流失 | Layer 2 不变量引擎(I1) | 每资产净流出上界:模拟前后余额差 amountDelta < 0 且账户归钱包所有 → UNDECLARED_TOKEN_OUTFLOW,high(当前 API 无逐资产声明,任何代币净流出都算越界) |

## 防御深度设计原则

1. **默认拒绝(strict)**:任何一门判定 deny,整笔交易拒绝;monitor 模式降级为人工确认,不静默放行。
2. **每层独立失效**:Layer 1 被绕过(如注入者伪造意图)→ Layer 2 模拟执行仍按真实效果拦截(T3);Layer 1+2 都被绕过(如私钥泄露直接签名)→ Layer 3 链上状态机拒绝(T6)。
3. **零信任签名边界**:防火墙的判定发生在**签名之前**;链上金库把"Agent 有密钥"和"资金可支配"解耦。

## 已知边界(诚实声明)

| 边界 | 说明 | 缓解计划 |
|---|---|---|
| legacy 交易无 CPI 可见性(不变量引擎仅 V0) | legacy 旧签名模拟只返回账户状态,不请求也不含 innerInstructions,效果收集器的内层扫描拿不到事实——完整不变量引擎(内层敏感指令 I4 + 分块 addresses 对账)仅对 V0 交易生效 | 联调强制 V0 交易;SDK 侧提示转换 |
| 24h 滚动支出为内存存储 | SDK 单进程有效,重启清零 | 生产接 Redis/DB(路线图) |
| 链上窗口用链上 Clock | 时钟由验证器提供,无用户可控漂移风险 | — |
| 白名单/限额为集中式策略 | 策略由 authority 管理 | TEE 密钥托管 + 策略 UI(路线图⑧) |
| 程序部署权限 = keypair | upgrade authority 私钥泄露可被替换程序 | 轮换制度;上线后考虑多签升级权限 |
