# Getting Started(克隆即可用的完整教程)

> 本文面向**任何一台标准机器**(Linux / macOS / Windows + WSL),无特殊网络要求。
> 按顺序走完,你将完成:跑通测试 → 用 SDK 校验交易 → 连真实 RPC 模拟 → 部署链上金库 → 接入 Agent。

## 0. 前置依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| Node.js | ≥ 20 | SDK / 测试 / 演示 / MCP |
| Rust + Solana 工具链 | `solana-cli` ≥ 1.18 + `cargo build-sbf` | 仅构建链上程序(第 5 步) |
| Anchor CLI | ≥ 0.30(可选) | 用 anchor 部署时 |

## 1. 克隆 + 跑通测试(2 分钟)

```bash
git clone https://github.com/keliq-wq/AI_Firewall.git
cd AI_Firewall
npm install
npm test            # 预期 32 passed
npm run pitch       # 离线四幕攻击演示,零网络,约 3 分钟
```

`pitch` 全程无需 RPC/钱包——四幕:提示注入 → owner 钓鱼 → 模拟层拦静默 drain → 链上金库架构。

## 2. 用 SDK 做第一笔校验(Layer 1,零依赖)

```ts
import { Firewall } from "./src"; // npm 发布后改为 "solana-agent-firewall"

const firewall = new Firewall({
  maxTransactionAmount: 0.5,        // 单笔上限(SOL)
  dailyLimit: 5,                    // 24h 滚动支出
  allowedPrograms: ["11111111111111111111111111111111"], // SystemProgram
});

const result = await firewall.validateTransaction({
  action: "transfer",
  amount: 50,                       // 提示注入场景:超额且无目的
  recipient: "<any-address>",
  // 注意:没有 purpose —— worth 门将拒绝
});

console.log(result.shouldProceed);  // false
console.log(result.concerns);       // 拒绝原因,按严重度排序
```

> `validateTransaction` 是纯离线解析,不签名、不发交易——它就是签名前的那道闸。

## 3. 启用第 2 层:真实 RPC 模拟(10 分钟)

第 2 层需要一个 Solana RPC(devnet 免费):

```ts
import { Connection } from "@solana/web3.js";
import { Firewall } from "./src";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const firewall = new Firewall({ /* 策略同上 */ }, { connection });

// 构造一笔真实攻击:声明 0.01 SOL,实际转 0.5
// → 第 1 层看声明金额放行;第 2 层模拟执行的净流出比对会拒绝
const result = await firewall.validateTransaction({
  action: "transfer",
  amount: 0.01,
  recipient: "<recipient>",
  purpose: "Pay for compute",
  wallet: "<agent-wallet-pubkey>",
  transaction: tx,                  // 原始交易(V0 或 legacy)
});
// result.concerns 应包含 UNEXPECTED_DRAIN(high)→ 拒绝
```

一键复现(内置五剧本,对真实 RPC 跑):

```bash
npx tsx scripts/live-attack.ts https://api.devnet.solana.com
# 需要 devnet 钱包注资:WALLET_KEYPAIR=~/.config/solana/id.json(devnet airdrop 后)
```

## 4. 接入 Agent:MCP 服务器(5 分钟)

MCP 客户端(Claude Desktop / Cursor / Claude Code)添加:

```json
{
  "mcpServers": {
    "solana-firewall": {
      "command": "node",
      "args": ["dist/mcp/server.js"],
      "env": { "SOLANA_RPC_URL": "https://api.devnet.solana.com" }
    }
  }
}
```

Agent 获得三个工具:`validate_transaction`(签名前校验)、`explain_decision`(自然语言风险叙述)、`get_policy`(查策略)。
冒烟验证:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n' | node dist/mcp/server.js
```

## 5. 部署链上金库(Layer 3,20 分钟)

```bash
# ① 构建程序(Linux/macOS 直接 anchor build;任何平台可 cargo build-sbf)
anchor build                 # 或: cd programs/firewall && cargo build-sbf
# 输出: target/deploy/firewall.so(根目录)与 IDL

# ② devnet 钱包 + airdrop
solana-keygen new -o ~/.config/solana/id.json --no-bip39-passphrase
solana config set --url https://api.devnet.solana.com
solana airdrop 3             # 不足时用 faucet.solana.com

# ③ 部署(无需 anchor,node 脚本直连 BPFLoaderUpgradeable)
npx tsx scripts/deploy-program.ts https://api.devnet.solana.com ~/.config/solana/id.json

# ④ 链上冒烟:初始化策略 → 入金 → 超限被链上拒绝 → 限额内成功
#   (首次运行自动生成 agent 钱包并打印注资命令)
npx tsx scripts/devnet-smoke.ts https://api.devnet.solana.com
```

每步输出 explorer.solana.com 交易链接,可直观验证链上拒绝。

## 6. 可视化面板(可选)

```bash
RPC_URL=https://api.devnet.solana.com npm run dashboard
# 打开 http://127.0.0.1:3000 —— 五剧本点击即测,中英切换
```

## 常见问题

- **pitch 报错**:确认 `npm install` 完成,Node ≥ 20。
- **第 2 层 simulateTransaction 报错**:RPC 端点必须支持 simulate;devnet 公共端点可用。
- **第 5 步 airdrop 限流**:devnet 每 IP/24h 限额,换 faucet.solana.com 网页。
- **anchor build 失败(Windows)**:本仓库程序在 Windows 原生环境的构建坑见 `docs/ONLINE-TESTING.md`;Linux/macOS 无此问题。
