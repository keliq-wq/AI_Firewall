/**
 * 不变量引擎真实 RPC 端到端验证(纯模拟,不发交易,零资金消耗)。
 *
 * 场景:对钱包名下真实的代币账户构造 Approve(无限授权)交易 → 模拟执行 →
 * 效果收集器应提取 delegate 突变 → I2 不变量 deny。
 * 对照组:同账户无权限突变的普通指令 → 无 INV 违规。
 *
 * 运行:RPC_URL=http://127.0.0.1:8896 WALLET_KEYPAIR=~/.config/solana/id.json npx tsx scripts/inv-live-check.ts
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Firewall } from "../src";

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8896";
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

function loadKp(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")) as number[]));
}

async function main(): Promise<void> {
  const walletPath = process.env.WALLET_KEYPAIR ?? join(homedir(), ".config", "solana", "id.json");
  if (!existsSync(walletPath)) {
    console.error("WALLET_KEYPAIR 不存在");
    process.exit(1);
  }
  const wallet = loadKp(walletPath);
  const connection = new Connection(RPC_URL, "confirmed");
  console.log(`钱包 ${wallet.publicKey.toBase58()} @ ${RPC_URL}`);

  // 找钱包名下余额 > 0 的代币账户
  const tokenAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, { programId: TOKEN_PROGRAM }, "confirmed");
  const funded = tokenAccounts.value.find((a) => {
    const d = Buffer.from(a.account.data);
    return d.length >= 165 && d.readBigUInt64LE(64) > 0n;
  });
  if (!funded) {
    console.error("钱包名下没有持有代币的账户——请先跑 scripts/sim-contract-spike.ts 造一个");
    process.exit(1);
  }
  const ata = funded.pubkey;
  const balance = Buffer.from(funded.account.data).readBigUInt64LE(64);
  console.log(`目标代币账户 ${ata.toBase58().slice(0, 12)}…(余额 ${balance})`);

  const attacker = Keypair.generate().publicKey;
  const approveData = Buffer.alloc(8);
  approveData.writeBigUInt64LE(2n ** 64n - 1n, 0); // u64::MAX 无限授权

  function buildV0(ix: TransactionInstruction): VersionedTransaction {
    return new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: "1".repeat(32),
        instructions: [ix],
      }).compileToV0Message(),
    );
  }

  const approveIx = new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: attacker, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([4]), approveData]),
  });
  const benignIx = new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.alloc(0),
  });

  const fw = new Firewall({ mode: "strict" }, { connection });

  console.log("\n① 攻击:Approve 无限授权 →");
  const r1 = await fw.validateTransaction({
    action: "custom",
    purpose: "claim airdrop",
    wallet: wallet.publicKey.toBase58(),
    transaction: buildV0(approveIx),
  });
  console.log(`   判定:${r1.shouldProceed ? "放行 ✗(不应发生)" : "拦截 ✓"}`);
  for (const c of r1.concerns.filter((x) => x.id.startsWith("INV_"))) {
    console.log(`   [${c.severity}] ${c.id}: ${c.message.slice(0, 110)}`);
  }

  console.log("\n② 对照:无权限突变指令 →");
  const r2 = await fw.validateTransaction({
    action: "custom",
    purpose: "sync",
    wallet: wallet.publicKey.toBase58(),
    transaction: buildV0(benignIx),
  });
  const invConcerns = r2.concerns.filter((x) => x.id.startsWith("INV_I2") || x.id.startsWith("INV_I4"));
  console.log(`   INV 权限违规数:${invConcerns.length} ${invConcerns.length === 0 ? "✓" : "✗(对照应无 I2/I4 违规)"}`);

  const ok = !r1.shouldProceed && invConcerns.length === 0;
  console.log(ok ? "\n✅ 不变量引擎真实 RPC 验证通过" : "\n❌ 验证失败");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
