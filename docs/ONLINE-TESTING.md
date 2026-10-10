# 线上测试指南(Devnet 部署 + Layer 2/3 联调)

> ⚠️ **本文是特定 Windows 机器的环境笔记**(网络被墙、solana CLI 坏、验证器特权坑)。
> 标准机器(Linux/macOS)请读 `docs/GETTING-STARTED.md`。
>
> 2026-10-09 实测网络状态:GitHub 直连不稳(git push 走 `-c http.proxy=http://127.0.0.1:7890`);
> `api.devnet.solana.com` ❌ 直连(走代理 7890 ✅);Alchemy demo devnet ✅ 直连(429 限流常见);
> Helius ✅ 连通(需 key);npmmirror ✅。所有命令基于 Windows + Git Bash + 项目根目录。
>
> **2026-10-10 更新**:程序 ID 已轮换为 `5ZtXDT2Qs1esK3UR61une1fqRkV8KQ7tssMqWXNUFXX`(旧私钥随公开仓库泄露已作废)。
> Layer 2 已在真实 RPC 面全场景验证 ✅。本机 solana CLI 损坏、验证器需管理员运行,全部用 node 脚本 + 提权绕行,见下。

## 0. 本机环境坑(全部实测,别踩)

| 坑 | 症状 | 绕行 |
|---|---|---|
| 验证器快照 symlink 特权 | slot 100 时 `os error 1314` 崩溃 | **管理员运行**(UAC 提权);且启动加 `--log`(默认 Dashboard 也为 validator.log 建 symlink) |
| 提权启动自锁 | `--reset` 报"另一个程序正在使用此文件" | 日志重定向文件放 ledger 目录**外**(如 `D:\validator.log`) |
| requestAirdrop 坏 | `Internal error`(RPC 拨 faucet `0.0.0.0:9900` → WSAEADDRNOTAVAIL) | 用 `/d/test-ledger/faucet-keypair.json` 直接转账(创世即有百万 SOL) |
| `--bpf-program` 预装无效 | 可执行但仍报 "Program is not deployed" | 用 `scripts/deploy-program.ts` 正常部署 |
| solana CLI 1.18 坏 | 回环地址假 `502`(系统代理 Clash 拦截,ProxyOverride 未生效) | 用 **agave 4.3 的 CLI**(`D:\agave\solana-release\bin`),回环/远程都正常 |
| simulateTransaction | 真实 RPC 强制要求 `accounts.addresses`(已修) | 见 src/rpc/simulator.ts |
| node 24.16 退出崩溃 | 结果打印后 libuv assertion | 无害,忽略 |
| cargo-build-sbf 4.4 Windows | `--tools-version` 非默认版 panic(get_base_rust_version 检查 `rustc` 无 .exe) | 复制无后缀副本:`cmd /c copy ...\rust\bin\rustc.exe ...\rust\bin\rustc` |

## 0.5 字节码与验证器代际(重要,2026-10-10 实测)

| 工具链 | rustc | 字节码可被验证的验证器 |
|---|---|---|
| platform-tools v1.57(默认) | 1.95(LLVM 20+) | agave 4.x(devnet 同代) |
| platform-tools v1.52 | 1.89(LLVM 19) | solana 2.x / agave 3.x+(推测) |
| platform-tools v1.41(不带 rustc,4.4 不支持) | — | solana 1.18 |

- 1.18.26 验证器**验证不了任何 2.0+ 工具链字节码**:v1.57 报 opcode 0xf7,v1.52 报 r10 只读 ABI 冲突(SBFv2 调用约定变更)
- **agave 4.x Windows 版 test-validator 全部有 genesis 自查 bug**:`hardened_unpack.rs` 的 `sanitize_path_and_open_dir` 用 std `File::open(parent)` 打开目录 → Windows 必报"拒绝访问" → 启动即失败(v3.1.14/v4.0-4.3 源码均存在)。**本机 Layer 3 本地测试暂时不可行,直接上 Devnet(4.x 运行时与工具链匹配)**

## 1. 本地验证器(Layer 2 联调)

**启动(管理员,屏幕上会弹 UAC 请点「是」)**:
```bash
powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c','D:\solana\solana-release\bin\solana-test-validator.exe --reset --log --ledger D:\test-ledger > D:\validator.log 2>&1' -Verb RunAs -WindowStyle Minimized"
# 等待就绪:curl -X POST http://127.0.0.1:8899 -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}'
# ⚠️ 用完务必杀掉(日志 ~1MB/分钟):taskkill /F /IM solana-test-validator.exe(需提权)
```

**Layer 2 攻击剧本(无需部署任何程序,2026-10-10 已全场景通过)**:
```bash
FAUCET_KEYPAIR=/d/test-ledger/faucet-keypair.json npx tsx scripts/live-attack.ts http://127.0.0.1:8899
# A owner 变更 / B 超额 / C 静默 drain(UNEXPECTED_DRAIN)/ D 黑名单 全拦截,对照组 5 门全过放行
```

**Layer 3 集成测试**:本机无可用验证器(见 0.5),走 Devnet:

## 2. Devnet 部署 + Layer 3 集成测试 + 链上冒烟(路线图第②步,主战场)

1. **airdrop**(官方 faucet 走代理,24h/IP 限流;429 或失败走 faucet.solana.com 网页):
   ```bash
   ADDR=$(cat ~/.config/solana/id.json | node -e "process.stdin.on('data',d=>{const k=require('@solana/web3.js').Keypair.fromSecretKey(Uint8Array.from(JSON.parse(d)));console.log(k.publicKey.toBase58())})")
   curl -x http://127.0.0.1:7890 -s -X POST https://api.devnet.solana.com -H "Content-Type: application/json" \
     -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"requestAirdrop\",\"params\":[\"$ADDR\",3000000000]}"
   ```
2. **部署**(node 脚本,Alchemy demo 直连;.so 默认 v1.57/v3 即可,devnet 4.x 同代):
   ```bash
   npx tsx scripts/deploy-program.ts https://solana-devnet.g.alchemy.com/v2/demo ~/.config/solana/id.json
   ```
3. **Layer 3 集成测试上 devnet**(FAUCET_KEYPAIR 指向已注资的钱包,测试钱包由其转账注资,合计 ~4.5 SOL):
   ```bash
   ANCHOR_PROVIDER_URL=https://solana-devnet.g.alchemy.com/v2/demo ANCHOR_WALLET=~/.config/solana/id.json \
   FAUCET_KEYPAIR=~/.config/solana/id.json npx ts-mocha -t 1000000 programs/firewall/tests/firewall.ts
   # 预期 6 用例全过:deposit / AmountExceeded / UnauthorizedAgent / 窗口记账 / DailyLimitExceeded / ProgramNotAllowed
   ```
4. **链上冒烟**:`npx tsx scripts/devnet-smoke.ts`(agent 钱包首次运行自动生成并打印注资命令)
5. **留存证据**:explorer.solana.com/tx/<sig>?cluster=devnet 链接截图
6. ⚠️ Devnet 定期重置,演示前重跑步骤 1-2

## 3. Layer 2 换 devnet RPC 联调

```bash
WALLET_KEYPAIR=~/.config/solana/id.json \
  npx tsx scripts/live-attack.ts https://solana-devnet.g.alchemy.com/v2/demo
```

## 5. 可视化面板(攻击演示 + 监控,2 合 1)

```bash
# 前提:rpc-proxy 在跑(node scripts/rpc-proxy.cjs → testnet)
RPC_URL=http://127.0.0.1:8898 WALLET_KEYPAIR=~/.config/solana/id.json \
  npx tsx demo/dashboard/server.ts     # 或 npm run dashboard
# 浏览器打开 http://127.0.0.1:3000
```

- 五个攻击剧本按钮(owner 钓鱼/超额/静默 drain/黑名单/对照组)→ 实时判定卡(严重度分级关切 + 中文叙述)
- 侧栏:策略卡、24h 支出仪表、链上状态(程序/金库)、事件时间线
- 零依赖后端(node:http),剧本定义在 scripts/attack-scenarios.ts(小金额,低余额钱包可跑)

## 4. 构建与部署速查

- 编译:`cd programs/firewall && cargo build-sbf [--arch v2|v3]` → 输出在**根** `target/deploy/firewall.so`(cargo-build-sbf 4.4 默认 v3、platform-tools v1.57)
- IDL:`~/.avm/bin/anchor-1.0.0 idl build > programs/firewall/target/idl/firewall.json`(从根目录)
- 部署:`npx tsx scripts/deploy-program.ts <RPC_URL> [payerKeypair]`——bincode fixint 编码(tag u32 + Vec len u64)、Buffer 元数据 37、ProgramData 45、programdata=PDA([program],loader)、36 字节程序账户预创建、残留自动清理,全部已踩坑验证
- 测试钱包注资:一律 `FAUCET_KEYPAIR=<faucet 或已注资钱包> ` 前缀(脚本自动转账)
- 本机 CLI:优先用 `D:\agave\solana-release\bin`(4.3 修好了 reqwest);1.18 的 CLI 只适合远程 URL

## 风险清单

- Alchemy demo 限流 429;devnet airdrop 限流;devnet 重置丢程序
- Layer 2 legacy 交易无 CPI 可见性 → 联调构造 V0
- 密钥不进 git:程序 keypair、id.json、faucet-keypair.json(均已 .gitignore 覆盖 target/)
- 本地 Layer 3 测试:等 agave 修复 Windows genesis 自查 bug,或直接用 Devnet(推荐)
