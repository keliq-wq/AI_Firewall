# 线上测试指南(Devnet 部署 + Layer 2/3 联调)

> 2026-10-09 实测网络状态:GitHub ✅ 直连(不稳,备选走代理);`api.devnet.solana.com` ❌ 直连(走本地代理 7890 ✅);
> Alchemy demo devnet ✅ 直连;Helius ✅ 连通(需 key);npmmirror ✅。
> 本指南所有命令基于 Windows + Git Bash + 项目根目录 `D:\AI_Firewall`。
>
> **2026-10-10 更新**:旧程序私钥已随公开仓库泄露 → 已轮换,新程序 ID `5ZtXDT2Qs1esK3UR61une1fqRkV8KQ7tssMqWXNUFXX`;
> git 历史已重写强推(`dc539b4`),旧私钥在 GitHub 上不可达。下方所有部署用新 ID。

## 0. 前置:网络通道备忘

| 用途 | 通道 | 命令形态 |
|---|---|---|
| 日常 RPC(部署/查询/模拟) | Alchemy demo 直连 | `https://solana-devnet.g.alchemy.com/v2/demo` |
| **airdrop(官方 faucet)** | 官方端点 + 代理 | `curl -x http://127.0.0.1:7890 ...` |
| git push(GitHub 直连抖时) | 一次性代理参数 | `git -c http.proxy=http://127.0.0.1:7890 push` |
| npm | npmmirror 直连 | 已配置 `.npmrc`,无需操作 |

## Step 1:安装 solana CLI(Windows)

**目标**:拿到 `solana` / `solana-keygen` / `solana-test-validator`,并生成 devnet 钱包。

1. 下载 v1.18.26(与本地 anchor 1.0 工具链同代;资产名已确认存在):
   ```bash
   curl -L -o /d/solana-cli.tar.bz2 \
     https://github.com/solana-labs/solana/releases/download/v1.18.26/solana-release-x86_64-pc-windows-msvc.tar.bz2
   ```
2. 解压到 `D:\solana`:
   ```bash
   mkdir -p /d/solana && tar -xjf /d/solana-cli.tar.bz2 -C /d/solana
   ```
3. 把 `D:\solana\solana-release\bin` 加入 PATH(系统设置 → 环境变量,或当前会话临时):
   ```bash
   export PATH="/d/solana/solana-release/bin:$PATH"
   solana --version   # 预期 solana-cli 1.18.26
   ```
4. 生成 devnet 钱包(Anchor.toml 里 `wallet = "~/.config/solana/id.json"` 正好对应;助记词抄好,只用于 devnet):
   ```bash
   solana-keygen new --outfile ~/.config/solana/id.json --no-bip39-passphrase
   solana address   # 记下公钥,Step 3 airdrop 用
   ```
5. 日常 RPC 指向 Alchemy demo(直连通道):
   ```bash
   solana config set --url https://solana-devnet.g.alchemy.com/v2/demo
   ```
6. 验证连通:
   ```bash
   solana cluster-version   # 预期返回 devnet 版本号
   ```

## Step 2:本地验证器跑 Layer 3 集成测试(纯本地)

**目标**:6 个链上测试用例(`programs/firewall/tests/firewall.ts`)真实运行。

已完成 ✅:测试依赖(ts-mocha/@coral-xyz/anchor/chai/@types/*)已装;测试文件已改为读 IDL JSON
(不再依赖 Windows 下无法生成的 `target/types`);程序 ID 取自 IDL address 字段。

1. 起本地验证器(独立终端,常驻):
   ```bash
   solana-test-validator --reset
   # 预期:RPC http://127.0.0.1:8899, WebSocket :8900,自带 faucet
   ```
   (Anchor 1.0 的 Surfpool 也可用,但 `anchor test` 会先走 build 撞 Windows panic,不冒险。)
2. 部署已编译的 `.so`(位于根目录 `target/deploy/firewall.so`,程序 ID 由 keypair 决定):
   ```bash
   solana airdrop 2 --url http://127.0.0.1:8899     # 本地 faucet,无限额
   solana program deploy target/deploy/firewall.so \
     --program-id target/deploy/firewall-keypair.json \
     --url http://127.0.0.1:8899
   # 预期:Program Id: 5ZtXDT2Qs1esK3UR61une1fqRkV8KQ7tssMqWXNUFXX
   ```
3. 跑测试(绕过 anchor test 的 build 环节,直接用 ts-mocha):
   ```bash
   ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
   ANCHOR_WALLET=~/.config/solana/id.json \
   npx ts-mocha -t 1000000 programs/firewall/tests/firewall.ts
   ```
   **预期 6 用例全过**:deposit 入金 / 超单笔限额拒绝(AmountExceeded)/ 非登记 Agent 拒绝(UnauthorizedAgent)/
   24h 滚动窗口记账 / 累计超日限额拒绝(DailyLimitExceeded)/ 非白名单协议拒绝(ProgramNotAllowed)。
   (测试内 `requestAirdrop` 走本地 faucet,每个随机 keypair 自动获得 10 SOL,无任何限流。)
4. **Layer 2 本地 RPC 联调**(同一验证器):
   ```bash
   npx tsx scripts/live-attack.ts http://127.0.0.1:8899
   # 预期:A owner 变更 / B 超额 / C 静默 drain / D 黑名单 全拦截,对照组放行,exit 0
   ```

## Step 3:Devnet 部署 + 链上冒烟(路线图第②步)

**目标**:程序部署到公网 Devnet,拿到可发给评委的链上交易证据。冒烟脚本 `scripts/devnet-smoke.ts` 已就绪。

1. **airdrop**(官方 faucet 走代理;devnet 有 24h/IP 限流,失败就等或走 faucet.solana.com 网页):
   ```bash
   ADDR=$(solana address)
   curl -x http://127.0.0.1:7890 -s -X POST https://api.devnet.solana.com \
     -H "Content-Type: application/json" \
     -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"requestAirdrop\",\"params\":[\"$ADDR\",3000000000]}"
   # 返回 signature 即成功;余额确认:
   solana balance   # 走 Alchemy demo,预期 3 SOL
   ```
   预算:`.so` 180KB → buffer 租金 ≈0.18 SOL,加初始化账户与交易费,3 SOL 足够。
2. **部署**(走 Alchemy demo 直连,不需要代理):
   ```bash
   solana program deploy target/deploy/firewall.so \
     --program-id target/deploy/firewall-keypair.json
   # 预期:Program Id: 5ZtXDT2Qs1esK3UR61une1fqRkV8KQ7tssMqWXNUFXX
   ```
3. **链上冒烟**:agent 钱包首次运行自动生成并打印注资命令:
   ```bash
   npx tsx scripts/devnet-smoke.ts
   # 场景:initialize(0.1/笔、1/天)→ deposit 1 SOL → withdraw 0.2(链上拒绝 AmountExceeded)
   #       → withdraw 0.05(成功)。每步输出 explorer.solana.com 交易链接。
   ```
4. **留存证据**:每条 tx 的 explorer 链接截图 → 演示视频素材。
5. ⚠️ **Devnet 会定期重置**:程序和数据会清空。演示/拍视频前重跑本步骤 1-2(airdrop 未超限时只需重部署)。

## Step 4:Layer 2 真实 RPC 联调 —— 攻击剧本(路线图第③步)

**目标**:Layer 2 模拟引擎接真实 devnet RPC,四个攻击场景全链路验证。脚本 `scripts/live-attack.ts` 已就绪,
并已在本地验证器预演(Step 2.4)。同一脚本换 devnet URL 再跑一遍:

```bash
# 用已注资钱包(id.json)+ devnet RPC
WALLET_KEYPAIR=~/.config/solana/id.json \
  npx tsx scripts/live-attack.ts https://solana-devnet.g.alchemy.com/v2/demo
```

| # | 场景 | 构造 | 预期拦截 |
|---|---|---|---|
| A | owner 变更攻击 | createAccount + assign(Tokenkeg)同一笔 V0 | simulation 门 `OWNER_CHANGE_SIMULATED` critical **deny** |
| B | 超额转出 | transfer 2 SOL 诚实声明(单笔上限 1) | Layer 1 limits **deny** |
| C | 静默 drain | 声明 0.01,实际转 0.5(伪造意图) | simulation 门 `UNEXPECTED_DRAIN` **deny**(只有模拟层看得见) |
| D | 黑名单协议 | 调用黑名单程序 ID | avoidance 门 **deny** |
| 对照组 | 0.5 SOL 正常转账 | 白名单、限额内、有目的 | **放行** |

> 场景 A 用 top-level assign(静态层和模拟层都会报);真正的「只有模拟层看得见」CPI 演示需要自建 SBF 转发程序,作为加分项延后。
> Helius/QuickNode 注册拿到 key 后(Helius 已确认连通),把 RPC_URL 换成专用端点即可作为长期演示配置。

## 风险与陷阱清单

- **airdrop 限流**:devnet 官方 faucet 按 IP 24h 限流;不够用 faucet.solana.com 网页(浏览器走代理)。
- **Alchemy demo 限流**:共享 demo key,仅限开发测试;高频/正式联调用 Helius/QuickNode 免费档。
- **legacy 无 CPI 可见性**:联调一律构造 V0 交易(脚本已如此)。
- **devnet 重置**:程序会丢,重新 deploy 即可(程序 ID 不变,keypair 决定)。
- **本地验证器时钟**:本地可 warp,devnet 不可;现有测试全部即时超额,不受影响。
- **密钥管理**:`~/.config/solana/id.json`、程序 keypair(两处:`programs/firewall/target/deploy/` 与根 `target/deploy/`,内容相同)、助记词一律不进 git(已在 .gitignore)。
- **程序重编译后**:`.so` 输出在根 `target/deploy/`;IDL 重新生成:`~/.avm/bin/anchor-1.0.0 idl build > programs/firewall/target/idl/firewall.json`(从根目录运行)。
