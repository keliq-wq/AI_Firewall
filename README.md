# Solana Agent Firewall 🛡️

**A transaction firewall for AI agents on Solana.** Three layers of defense stand between an agent's intent and its signature — so prompt injection, owner phishing, and leaked private keys don't mean drained wallets.

```
                ┌────────────────────────────────────────────────────┐
 Agent intent  │  Layer 1  Client-side CLAW gates (offline, <1ms)    │
      + raw tx ─┤  credibility · limits · avoidance · worth          │
                ├────────────────────────────────────────────────────┤
                │  Layer 2  Simulation on real RPC state             │
                │  CPI owner-change · net-outflow vs declared amount │
                ├────────────────────────────────────────────────────┤
                │  Layer 3  On-chain enforcement vault (PDA)         │
                │  agent key has ZERO power over vault funds         │
                └────────────────────────────────────────────────────┘
```

- **Layer 1** — CLAW four-gate protocol: whitelist + owner-change detection, amount & 24h rolling limits, blacklists, business-purpose requirements. Pure offline parsing of legacy/V0 transactions.
- **Layer 2** — simulates the transaction against live chain state *before signing*: catches inner-instruction owner transfers and drains hidden behind a fake declared amount.
- **Layer 3** — an Anchor program where funds live in a PDA vault: even with the agent's private key fully compromised, withdrawals must pass on-chain identity, per-tx cap, allowlist, destination and 24h-window checks.

## Quick start

```bash
git clone https://github.com/keliq-wq/AI_Firewall.git
cd AI_Firewall
npm install
npm test          # 80 tests(20 文件)
npm run dashboard # 零构建,自动打开浏览器:剧本演示 + 实时拦截日志(SSE 实时流,重启不丢)
```

> Windows 一键体验:装好 Node.js 后直接**双击仓库根目录的 `start-dashboard.bat`**
> ——首次自动安装依赖,然后自动弹出面板,全程不用输任何命令。

Or install directly from GitHub (works before the npm release):

```bash
npm install github:keliq-wq/AI_Firewall
```

```ts
import { Firewall } from "./src";

const firewall = new Firewall(
  {
    maxTransactionAmount: 0.5,          // SOL per transaction
    dailyLimit: 5,                      // 24h rolling spend
    allowedPrograms: ["11111111111111111111111111111111"],
    blockedPrograms: ["<scam-program-id>"],
  },
  { connection },                       // provide an RPC connection to enable Layer 2
);

const result = await firewall.validateTransaction({
  action: "transfer",
  amount: 0.3,
  recipient: "<recipient>",
  purpose: "Pay for compute",
  wallet: "<agent-wallet>",
  transaction: tx,                      // legacy or V0
});

if (result.shouldProceed) {
  /* sign and send */
} else if (result.requiresConfirmation) {
  /* ask a human */
} else {
  console.log(result.concerns);         // ranked reasons, critical first
}
```

## Integrations

### MCP server (for Claude / Cursor / any MCP agent)

```bash
npm run build && node dist/mcp/server.js   # stdio
# env SOLANA_RPC_URL=<rpc> enables Layer 2 simulation
```

Tools exposed: `validate_transaction`, `explain_decision` (natural-language risk narration, zh/en), `get_policy`.

### solana-agent-kit plugin

```ts
const agent = new SolanaAgentKit(privateKey, rpcUrl)
  .use(FirewallPlugin({ maxTransactionAmount: 0.5 }));
await agent.methods.validateTransaction({ action: "transfer", amount: 0.3, ... });
```

### Live dashboard (attack demos + monitoring)

```bash
npm run dashboard          # http://127.0.0.1:3000
# RPC_URL / WALLET_KEYPAIR / FAUCET_KEYPAIR env vars configure the chain target
```

Five one-click attack scenarios (owner phishing, over-limit, silent drain, blacklisted program, legit control) run against **real RPC simulation**, with a policy panel, 24h-spend meter, on-chain status and event timeline. UI is Chinese/English toggleable.

## Layer 3 on-chain program

- Program ID: `5ZtXDT2Qs1esK3UR61une1fqRkV8KQ7tssMqWXNUFXX` (SBFv2/v3, build with `cargo build-sbf`)
- Deploy: `npx tsx scripts/deploy-program.ts <RPC_URL> [payer-keypair]`
- Instructions: `initialize` (register agent, per-tx cap, daily cap, allowlist) · `deposit` · `withdraw` · `execute` · `update_policy`
- Error codes: `AmountExceeded` 6000 · `DailyLimitExceeded` 6002 · `ProgramNotAllowed` 6003 · `UnauthorizedAgent` 6004 · …
- Verified live on Solana testnet: every rejection is a real on-chain revert (see `docs/ONLINE-TESTING.md`).

## Repository layout

```
src/                 core library (gates, parser, simulator, narrator, MCP, agent-kit)
programs/firewall/   Anchor program (Layer 3) + integration tests
scripts/             deploy / attack scenarios / RPC proxy / confirm helpers
demo/                dashboard/ (web console)
docs/                online-testing guide · demo narration guide
```

## More

- **`docs/GETTING-STARTED.md`** — full tutorial from clone to on-chain vault (start here)
- `docs/THREAT-MODEL.md` — attack vectors × defense mapping, known boundaries
- `docs/CHAIN-EVIDENCE.md` — live testnet transactions: every rejection is a real on-chain revert
- `docs/ONLINE-TESTING.md` — environment notes for a specific Windows machine (not needed on Linux/macOS)

## License

MIT
