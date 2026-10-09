/**
 * Layer 2 真实 RPC 联调 —— 攻击剧本（Step 4 / Step 2.6 本地预演）。
 *
 * 运行：
 *   npx tsx scripts/live-attack.ts                     # 本地验证器 http://127.0.0.1:8899
 *   npx tsx scripts/live-attack.ts <RPC_URL>           # 例：https://solana-devnet.g.alchemy.com/v2/demo
 *   WALLET_KEYPAIR=~/.config/solana/id.json npx tsx scripts/live-attack.ts <RPC_URL>   # 用已注资钱包
 *
 * 未提供钱包时自动生成新 keypair 并 requestAirdrop 10 SOL（仅本地验证器支持）。
 * 全部场景构造 V0 交易（legacy 在真实 RPC 下无 CPI 可见性，见已知技术债）。
 *
 * 预期判定：A/B/C/D 全部拦截，对照组放行；任一不符则退出码 1。
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Firewall, TransactionIntent } from "../src";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const RPC_URL = process.argv[2] ?? "http://127.0.0.1:8899";
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SCAM_PROGRAM_ID = Keypair.generate().publicKey; // 黑名单演示用随机程序

const line = "─".repeat(64);
function act(title: string): void {
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function loadWallet(): Keypair {
  const path = process.env.WALLET_KEYPAIR;
  if (path) {
    const raw = readFileSync(path.replace(/^~/, homedir()), "utf-8");
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
  }
  return Keypair.generate();
}

async function main(): Promise<void> {
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = loadWallet();

  if (!process.env.WALLET_KEYPAIR) {
    const sig = await connection.requestAirdrop(wallet.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    console.log(`  新钱包 ${wallet.publicKey.toBase58()} 已 airdrop 10 SOL`);
  } else {
    console.log(`  使用已注资钱包 ${wallet.publicKey.toBase58()}`);
  }

  // 策略：单笔上限 1 SOL、日限 10 SOL、白名单仅 SystemProgram、黑名单 SCAM_PROGRAM_ID
  const firewall = new Firewall(
    {
      mode: "strict",
      maxTransactionAmount: 1,
      dailyLimit: 10,
      allowedPrograms: [SystemProgram.programId.toBase58()],
      blockedPrograms: [SCAM_PROGRAM_ID.toBase58()],
      simulationFeeTolerance: 0.05,
    },
    { connection }, // 注入真实 RPC → 启用第 2 层 simulation 门
  );

  async function buildV0(instructions: TransactionInstruction[]): Promise<VersionedTransaction> {
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    return new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message(),
    );
  }

  let pass = true;
  async function verdict(label: string, intent: TransactionIntent, expectBlocked: boolean): Promise<void> {
    const r = await firewall.validateTransaction(intent);
    const mark = r.shouldProceed ? "✓ 放行" : r.requiresConfirmation ? "⚠ 需人工确认" : "✗ 拦截";
    const ok = r.shouldProceed === !expectBlocked;
    if (!ok) pass = false;
    console.log(`\n  [${label}] 判定：${mark}${ok ? "" : "  ← 与预期不符!"}  ${r.summary}`);
    for (const c of r.concerns.slice(0, 3)) {
      console.log(`    · [${c.severity}] ${c.message}`);
    }
    if (r.requiresConfirmation) console.log(`    · 叙述：${await firewall.explain(intent, r)}`);
  }

  const recipient = Keypair.generate().publicKey;
  const treasury = Keypair.generate(); // 场景 A 的「金库」账户

  // ── A：owner 变更攻击（createAccount + assign 同一笔交易）──
  act("场景 A · owner 变更攻击（真实 RPC 模拟揭示）");
  console.log("  攻击者诱导 Agent 签署「开通代币账户」交易，实际把金库账户");
  console.log("  owner 静默转移给 Token 程序——静态解析也能看见 assign，但");
  console.log("  第 2 层模拟执行在真实链上给出独立的 critical 证据。");
  {
    const rent = await connection.getMinimumBalanceForRentExemption(0);
    const tx = await buildV0([
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: treasury.publicKey,
        lamports: rent,
        space: 0,
        programId: SystemProgram.programId,
      }),
      SystemProgram.assign({ accountPubkey: treasury.publicKey, programId: TOKEN_PROGRAM_ID }),
    ]);
    await verdict(
      "A",
      {
        action: "custom",
        purpose: "Open token account",
        wallet: wallet.publicKey.toBase58(),
        transaction: tx,
      },
      true,
    );
  }

  // ── B：超额转出（诚实声明，Layer 1 直接拦截）──
  act("场景 B · 超额转出 2 SOL（单笔上限 1 SOL）→ 第 1 层拦截");
  {
    const tx = await buildV0([
      SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: recipient, lamports: 2 * LAMPORTS_PER_SOL }),
    ]);
    await verdict(
      "B",
      {
        action: "transfer",
        amount: 2,
        recipient: recipient.toBase58(),
        purpose: "Settle invoice",
        wallet: wallet.publicKey.toBase58(),
        transaction: tx,
      },
      true,
    );
  }

  // ── C：静默 drain（伪造声明 0.01，实际转 0.5）──
  act("场景 C · 静默 drain：声明 0.01 SOL，实际转 0.5 SOL → 只有第 2 层看得见");
  console.log("  第 1 层基于声明金额放行；模拟执行的净流出比对发现真实流出");
  console.log("  0.5 SOL 远超声明+tolerance → UNEXPECTED_DRAIN deny。");
  {
    const tx = await buildV0([
      SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: recipient, lamports: 0.5 * LAMPORTS_PER_SOL }),
    ]);
    await verdict(
      "C",
      {
        action: "transfer",
        amount: 0.01,
        recipient: recipient.toBase58(),
        purpose: "Settle invoice",
        wallet: wallet.publicKey.toBase58(),
        transaction: tx,
      },
      true,
    );
  }

  // ── D：黑名单协议 ──
  act("场景 D · 调用黑名单协议 → 第 1 层 avoidance 门拦截");
  {
    const tx = await buildV0([{ programId: SCAM_PROGRAM_ID, keys: [], data: Buffer.alloc(0) }]);
    await verdict(
      "D",
      {
        action: "custom",
        purpose: "Claim airdrop",
        programIds: [SCAM_PROGRAM_ID.toBase58()],
        wallet: wallet.publicKey.toBase58(),
        transaction: tx,
      },
      true,
    );
  }

  // ── 对照组：0.5 SOL 白名单转账（限额内、目的明确）→ 放行 ──
  act("对照组 · 0.5 SOL 正常转账（白名单协议、限额内、有目的）→ 放行");
  {
    const tx = await buildV0([
      SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: recipient, lamports: 0.5 * LAMPORTS_PER_SOL }),
    ]);
    await verdict(
      "control",
      {
        action: "transfer",
        amount: 0.5,
        recipient: recipient.toBase58(),
        purpose: "Pay for compute",
        wallet: wallet.publicKey.toBase58(),
        transaction: tx,
      },
      false,
    );
  }

  console.log(`\n${line}`);
  console.log(pass ? "  ✅ 全部场景判定符合预期" : "  ❌ 存在与预期不符的场景");
  console.log(line);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
