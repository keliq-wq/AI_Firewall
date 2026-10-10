/**
 * 真实钱包交易示例 —— 在别的目录里用防火墙保护真实转账的完整流程。
 *
 * 用法(任意目录,先 npm install github:keliq-wq/AI_Firewall @solana/web3.js@1 tsx):
 * 注意:web3.js 必须固定 v1(防火墙库基于 v1.99;v2 API 不兼容)。
 *
 *   RPC_URL=https://api.devnet.solana.com \
 *   WALLET_KEYPAIR=~/.config/solana/id.json \
 *   npx tsx real-wallet-transfer.ts <收款地址> <金额SOL> [业务理由]
 *
 * 演练(不签名不发交易,只看防火墙判定):
 *   DRY_RUN=1 ... 同上
 *
 * 流程:构造交易(未签名)→ 防火墙签名前验证(Layer 1 四门 + Layer 2 真实 RPC 模拟执行)
 *      → 放行才签名发送;拦截则打印原因并退出。
 *
 * 安全要点:
 * - 密钥只留在本机,绝不进代码/日志;示例从环境变量路径读 keypair
 * - 先 devnet 验证再上主网;主网把 RPC_URL 换成 https://api.mainnet-beta.solana.com
 * - 本示例覆盖 Layer 1+2;资金要防私钥泄露兜底,走 Layer 3 金库(见 programs/firewall)
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Firewall } from "solana-agent-firewall";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const WALLET_PATH = process.env.WALLET_KEYPAIR || join(homedir(), ".config", "solana", "id.json");
const DRY_RUN = process.env.DRY_RUN === "1";

function loadWallet(): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(WALLET_PATH, "utf-8")) as number[]));
}

async function main(): Promise<void> {
  const [recipientArg, amountArg, purposeArg] = process.argv.slice(2);
  if (!recipientArg || !amountArg) {
    console.error("用法: npx tsx real-wallet-transfer.ts <收款地址> <金额SOL> [业务理由]");
    process.exit(2);
  }
  const recipient = new PublicKey(recipientArg);
  const amount = Number(amountArg);
  const purpose = purposeArg || "manual transfer (example)";
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error("金额必须是正数(SOL)");
    process.exit(2);
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = loadWallet();
  console.log(`钱包: ${wallet.publicKey.toBase58()}`);
  console.log(`RPC : ${RPC_URL}`);
  console.log(`转账: ${amount} SOL → ${recipient.toBase58()}`);

  // 1. 构造交易(尚未签名)
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: recipient,
      lamports: Math.round(amount * LAMPORTS_PER_SOL),
    }),
  );
  tx.feePayer = wallet.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  // 2. 防火墙在签名前验证:声明意图 + 原始交易字节 → Layer 1 四门 + Layer 2 模拟执行
  const firewall = new Firewall(
    {
      maxTransactionAmount: 1, // 单笔上限(SOL)
      dailyLimit: 5, // 24h 滚动支出上限
      allowedPrograms: [SystemProgram.programId.toBase58()], // 白名单:只允许系统转账
    },
    { connection }, // 配置 RPC 后启用第 2 层(真实链上状态模拟)
  );

  const result = await firewall.validateTransaction({
    action: "transfer",
    amount,
    recipient: recipient.toBase58(),
    purpose, // 敏感操作必须声明业务理由(worth 门硬基线)
    wallet: wallet.publicKey.toBase58(), // 声明钱包 → 模拟门据此比对净流出
    transaction: tx,
    idempotencyKey: `transfer:${recipient.toBase58()}:${Date.now()}`, // 幂等:重复校验不虚增 24h 记账
  });

  console.log(`\n判定: ${result.shouldProceed ? "✓ 放行" : result.requiresConfirmation ? "⚠ 需人工确认" : "✗ 拦截"}`);
  console.log(`摘要: ${result.summary}`);
  for (const c of result.concerns) console.log(`  [${c.severity}] ${c.id}: ${c.message}`);

  if (!result.shouldProceed) {
    console.error("\n防火墙拦截,未签名、未发送。");
    process.exit(1);
  }
  if (result.requiresConfirmation) {
    console.error("\n需人工确认(escalate),示例不自动放行——检查上面关切项后再决定。");
    process.exit(1);
  }
  if (DRY_RUN) {
    console.log("\nDRY_RUN=1:演练结束,未签名、未发送。");
    return;
  }

  // 3. 放行 → 签名并发送(整笔交易单次签齐)
  tx.sign(wallet);
  const raw = tx.serialize();
  // 公共 RPC 偶发 502/429:重发同一笔 raw 是幂等的(同签名同交易,不会重复扣款)
  let signature: string | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      signature = await connection.sendRawTransaction(raw);
      break;
    } catch (e) {
      console.error(`发送失败(第 ${attempt + 1}/5 次): ${(e as Error).message.slice(0, 80)}`);
      if (attempt === 4) {
        console.error("连续失败。若交易其实已上链(响应丢失),重跑脚本前先查钱包最近交易,避免新 blockhash 重复转账。");
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  // HTTP 轮询确认(WS 订阅在代理/慢网络下竞态超时,轮询最稳)
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const status = await connection.getSignatureStatuses([signature!]);
      const s = status.value[0];
      if (s?.err) throw new Error(`交易失败: ${JSON.stringify(s.err)}`);
      if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") break;
    } catch (e) {
      if (i === 89) throw e; // 最后一轮仍失败才抛出(中途失败视为瞬时抖动)
    }
  }
  const cluster = RPC_URL.includes("mainnet") ? "mainnet" : "devnet";
  console.log(`\n✅ 已上链: https://explorer.solana.com/tx/${signature}?cluster=${cluster}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
