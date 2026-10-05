/**
 * AI Agent 交易防火墙 — 第 1 层演示
 * 五个场景：良性放行 / 缺 purpose 拦截 / 金额超限拦截 / owner 钓鱼拦截 / monitor 降级
 * 运行：npm run demo
 */
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { Firewall, TransactionIntent } from "../src";

const WALLET = Keypair.generate();
const ATTACKER_PROGRAM = Keypair.generate().publicKey; // 模拟恶意程序地址

async function run(scenario: string, intent: TransactionIntent): Promise<void> {
  const fw = new Firewall();
  const result = await fw.validateTransaction(intent);
  console.log(`\n=== ${scenario} ===`);
  console.log(`  summary: ${result.summary}`);
  for (const d of result.decisions) {
    const mark = d.verdict === "allow" ? "✓" : d.verdict === "deny" ? "✗" : "⚠";
    console.log(`  [${mark}] ${d.gate.padEnd(12)} ${d.verdict}`);
    for (const c of d.concerns) {
      console.log(`       - [${c.severity}] ${c.message}`);
    }
  }
}

async function main(): Promise<void> {
  console.log("AI Agent 交易防火墙 — Layer 1 (CLAW 四门协议) 演示");
  console.log(`Agent 钱包: ${WALLET.publicKey.toBase58()}`);

  // 场景 1：良性转账（0.5 SOL，有 purpose）→ 放行
  const benignTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: WALLET.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 0.5 * LAMPORTS_PER_SOL,
    }),
  );
  await run("场景 1：良性转账 0.5 SOL（有业务理由）", {
    action: "transfer",
    amount: 0.5,
    purpose: "Payment for NFT purchase",
    recipient: "RecipientWallet",
    transaction: benignTx,
  });

  // 场景 2：缺少 purpose 的转账（提示注入后无理由转账）→ 拦截
  await run("场景 2：Agent 被提示注入后无理由转账 50 SOL", {
    action: "transfer",
    amount: 50,
    recipient: Keypair.generate().publicKey.toBase58(),
    // 没有 purpose
  });

  // 场景 3：金额超过单笔上限 → 拦截
  await run("场景 3：单笔 250 SOL 超过上限 100", {
    action: "transfer",
    amount: 250,
    purpose: "Portfolio rebalance",
  });

  // 场景 4：owner 权限钓鱼（核心场景）→ critical 拦截
  const phishingTx = new Transaction().add(
    SystemProgram.assign({
      accountPubkey: WALLET.publicKey,
      programId: ATTACKER_PROGRAM, // 将钱包主账户 owner 静默转移给恶意程序
    }),
  );
  await run("场景 4：owner 钓鱼——签名后资产控制权将转移给恶意程序", {
    action: "custom",
    purpose: "Claim free airdrop", // 钓鱼话术
    transaction: phishingTx,
  });

  // 场景 5：monitor 模式——同样的高危交易降级为"需人工确认"
  const monitor = new Firewall({ mode: "monitor" });
  const monitored = await monitor.validateTransaction({ action: "transfer", amount: 50 });
  console.log(`\n=== 场景 5：monitor 模式——高危交易降级为人工确认 ===`);
  console.log(`  shouldProceed: ${monitored.shouldProceed}`);
  console.log(`  requiresConfirmation: ${monitored.requiresConfirmation}`);
  console.log(`  summary: ${monitored.summary}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
