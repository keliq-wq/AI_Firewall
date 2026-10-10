/**
 * P4 链上不变量 I1 运行时验证(devnet,程序 ID 5ZtXDT2Q… 含 execute 后置断言)。
 *
 * 场景:白名单 = SystemProgram。execute 声明 amount=0.01,但 CPI data 让金库实转 0.02 →
 * 链上断言「金库净流出 ≤ 声明金额」应 revert 6011(InvariantI1Violated)。
 * 对照组:声明 0.01 实转 0.01 → 成功。
 *
 * 注:I2(代币权限突变)断言需 3 账户 CPI,当前 execute 固定双账户不可触发,已文档化。
 *
 * 运行:RPC_URL=http://127.0.0.1:8894 npx tsx scripts/i1-onchain-check.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { confirmHttp, getLatestBlockhashRetry, sendRawTransactionRetry } from "./tx-confirm";
import idl from "../programs/firewall/idl/firewall.json";

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8894";
const CLUSTER = process.env.CLUSTER || "devnet";
const PROGRAM_ID = new PublicKey((idl as any).address);
const MAX_PER_TX = 0.1 * LAMPORTS_PER_SOL;
const DAILY_LIMIT = 1 * LAMPORTS_PER_SOL;

const line = "─".repeat(64);
const link = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;

async function main(): Promise<void> {
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(join(homedir(), ".config", "solana", "id.json"), "utf-8")) as number[]),
  );
  const connection = new Connection(RPC_URL, "confirmed");
  console.log(`authority ${authority.publicKey.toBase58()} @ ${RPC_URL}`);

  // agent 持久化:policy 一旦初始化就登记 agent,跨运行必须复用同一 keypair
  const agentPath = join(__dirname, "keys", "i1-agent.json");
  let agent: Keypair;
  if (existsSync(agentPath)) {
    agent = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(agentPath, "utf-8")) as number[]));
  } else {
    agent = Keypair.generate();
    mkdirSync(dirname(agentPath), { recursive: true });
    writeFileSync(agentPath, JSON.stringify(Array.from(agent.secretKey)));
  }
  const destination = Keypair.generate().publicKey;

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authority), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(idl as anchor.Idl, provider);

  const [policyPda] = PublicKey.findProgramAddressSync([Buffer.from("policy"), authority.publicKey.toBuffer()], PROGRAM_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), authority.publicKey.toBuffer()], PROGRAM_ID);
  const [vaultStatePda] = PublicKey.findProgramAddressSync([Buffer.from("vault-state"), authority.publicKey.toBuffer()], PROGRAM_ID);

  async function sendAndCheck(tx: Transaction, label: string, signers: Keypair[] = []): Promise<{ signature: string; err: unknown }> {
    tx.feePayer = authority.publicKey;
    tx.recentBlockhash = (await getLatestBlockhashRetry(connection)).blockhash;
    const others = signers.filter((s) => !s.publicKey.equals(authority.publicKey));
    // 注意:web3.js v1.99 每次 _compile 会重建签名数组,分次 sign 会互相清掉——
    // 必须单次 sign() 签齐全部
    tx.sign(authority, ...others);
    const signature = await sendRawTransactionRetry(connection, tx);
    const r = await confirmHttp(connection, signature);
    console.log(`  ${label}: err=${r.err == null ? "null ✓" : JSON.stringify(r.err).slice(0, 80)}`);
    return r;
  }

  // 注资 agent(0.3 SOL)
  {
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: agent.publicKey, lamports: 0.3 * LAMPORTS_PER_SOL }),
    );
    await sendAndCheck(tx, `注资 agent ${agent.publicKey.toBase58().slice(0, 8)}…`);
  }

  // initialize(白名单仅 SystemProgram);已存在时用 update_policy 把登记 agent 对齐到持久化 agent
  if (!(await connection.getAccountInfo(policyPda))) {
    const tx = await program.methods
      .initialize(agent.publicKey, new anchor.BN(MAX_PER_TX), new anchor.BN(DAILY_LIMIT), [SystemProgram.programId])
      .accounts({ authority: authority.publicKey, policy: policyPda, vault_state: vaultStatePda, vault: vaultPda })
      .signers([authority])
      .transaction();
    await sendAndCheck(tx, "initialize(白名单=SystemProgram)", [authority]);
  } else {
    const tx = await program.methods
      .updatePolicy(agent.publicKey, new anchor.BN(MAX_PER_TX), new anchor.BN(DAILY_LIMIT), [SystemProgram.programId])
      .accounts({ authority: authority.publicKey, policy: policyPda })
      .signers([authority])
      .transaction();
    await sendAndCheck(tx, "update_policy(对齐持久化 agent + 白名单=SystemProgram)", [authority]);
  }
  if ((await connection.getBalance(vaultPda)) < 0.1 * LAMPORTS_PER_SOL) {
    const tx = await program.methods
      .deposit(new anchor.BN(0.1 * LAMPORTS_PER_SOL))
      .accounts({ depositor: agent.publicKey, policy: policyPda, vault: vaultPda })
      .signers([agent])
      .transaction();
    await sendAndCheck(tx, "deposit 0.1 SOL 入金库", [agent]);
  }

  // execute CPI data:SystemProgram.transfer:tag 为 u32 LE(4 字节)+ u64 amount
  const execData = (amount: number) => {
    const d = Buffer.alloc(12);
    d.writeUInt32LE(2, 0);
    d.writeBigUInt64LE(BigInt(Math.round(amount * LAMPORTS_PER_SOL)), 4);
    return d;
  };

  console.log(`\n${line}\n  ① I1 攻击:execute 声明 0.01,CPI 实转 0.02 → 预期 revert 6011\n${line}`);
  {
    const tx = await program.methods
      .execute(new anchor.BN(0.01 * LAMPORTS_PER_SOL), execData(0.02))
      .accounts({
        agent: agent.publicKey,
        policy: policyPda,
        vault_state: vaultStatePda,
        vault: vaultPda,
        targetProgram: SystemProgram.programId,
        destination,
      })
      .signers([agent])
      .transaction();
    const r = await sendAndCheck(tx, "execute(声明 0.01 / 实转 0.02)", [agent]);
    const errStr = JSON.stringify(r.err);
    const isI1 = errStr.includes("6011");
    console.log(`  → ${isI1 ? "✅ InvariantI1Violated(6011) 链上拒绝" : "❌ 未按预期拒绝"}`);
    console.log(`  证据:${link(r.signature)}`);
    if (!isI1) process.exit(1);
  }

  console.log(`\n${line}\n  ② 对照:execute 声明 0.01,CPI 实转 0.01 → 预期成功\n${line}`);
  {
    const tx = await program.methods
      .execute(new anchor.BN(0.01 * LAMPORTS_PER_SOL), execData(0.01))
      .accounts({
        agent: agent.publicKey,
        policy: policyPda,
        vault_state: vaultStatePda,
        vault: vaultPda,
        targetProgram: SystemProgram.programId,
        destination,
      })
      .signers([agent])
      .transaction();
    const r = await sendAndCheck(tx, "execute(声明 0.01 / 实转 0.01)", [agent]);
    console.log(`  → ${r.err == null ? "✅ 成功" : "❌ 意外失败"}`);
    console.log(`  证据:${link(r.signature)}`);
    if (r.err != null) process.exit(1);
  }

  console.log(`\n${line}`);
  console.log("✅ P4 链上不变量 I1 运行时验证完成:效果 ⊆ 信封在链上强制生效");
  console.log(line);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
