/**
 * Step 3 链上冒烟（Devnet）：程序部署后运行，产出可发给评委的链上证据。
 *
 * 前置：
 *   1. 已 solana program deploy（程序 ID 见 IDL address）
 *   2. authority 钱包 = ~/.config/solana/id.json（已 airdrop ≥3 SOL）
 *   3. agent 钱包 = scripts/keys/devnet-agent.json（首次运行自动生成，按提示注资 ≥1.5 SOL）
 *
 * 运行：
 *   npx tsx scripts/devnet-smoke.ts [RPC_URL]     # 默认 https://solana-devnet.g.alchemy.com/v2/demo
 *
 * 场景：initialize（单笔 0.1 SOL / 日限 1 SOL）→ deposit 1 SOL → withdraw 0.2（链上拒绝 AmountExceeded）
 *       → withdraw 0.05（成功，金库余额变化）。每步输出 explorer.solana.com 交易链接。
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import idl from "../programs/firewall/target/idl/firewall.json";

const RPC_URL = process.argv[2] ?? "https://solana-devnet.g.alchemy.com/v2/demo";
const CLUSTER = RPC_URL.includes("localhost") || RPC_URL.includes("127.0.0.1") ? "custom" : "devnet";
const PROGRAM_ID = new PublicKey((idl as any).address);
const MAX_PER_TX = 0.1 * LAMPORTS_PER_SOL;
const DAILY_LIMIT = 1 * LAMPORTS_PER_SOL;

const line = "─".repeat(64);
function link(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
}
function loadKp(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")) as number[]));
}

async function main(): Promise<void> {
  const authorityPath = join(homedir(), ".config", "solana", "id.json");
  if (!existsSync(authorityPath)) {
    console.error("未找到 authority 钱包 ~/.config/solana/id.json，请先完成 Step 1.4");
    process.exit(1);
  }
  const authority = loadKp(authorityPath);

  const agentPath = join(__dirname, "keys", "devnet-agent.json");
  if (!existsSync(agentPath)) {
    const kp = Keypair.generate();
    mkdirSync(dirname(agentPath), { recursive: true });
    writeFileSync(agentPath, JSON.stringify(Array.from(kp.secretKey)));
    console.log(`已生成 agent 钱包 ${kp.publicKey.toBase58()} → scripts/keys/devnet-agent.json`);
    console.log(`请注资 ≥1.5 SOL（官方 faucet 走代理）：`);
    console.log(
      `  curl -x http://127.0.0.1:7890 -s -X POST https://api.devnet.solana.com -H "Content-Type: application/json" ` +
        `-d '{"jsonrpc":"2.0","id":1,"method":"requestAirdrop","params":["${kp.publicKey.toBase58()}",2000000000]}'`,
    );
    process.exit(0);
  }
  const agent = loadKp(agentPath);

  console.log(`\n${line}\n  链上冒烟：程序 ${PROGRAM_ID.toBase58()} @ ${RPC_URL}\n${line}`);

  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authority), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = new Program(idl as anchor.Idl, provider); // programId 取自 idl.address

  const [policyPda] = PublicKey.findProgramAddressSync([Buffer.from("policy"), authority.publicKey.toBuffer()], PROGRAM_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), authority.publicKey.toBuffer()], PROGRAM_ID);
  const [vaultStatePda] = PublicKey.findProgramAddressSync([Buffer.from("vault-state"), authority.publicKey.toBuffer()], PROGRAM_ID);

  const programAccount = await connection.getAccountInfo(PROGRAM_ID);
  if (!programAccount?.executable) {
    console.error(`✗ 程序未部署到该 RPC（${PROGRAM_ID.toBase58()} 不存在或不可执行）`);
    process.exit(1);
  }
  const [authBal, agentBal] = await Promise.all([
    connection.getBalance(authority.publicKey),
    connection.getBalance(agent.publicKey),
  ]);
  console.log(`  authority ${authority.publicKey.toBase58()}：${(authBal / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  console.log(`  agent     ${agent.publicKey.toBase58()}：${(agentBal / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  if (agentBal < 1.1 * LAMPORTS_PER_SOL) {
    console.error("✗ agent 余额不足（deposit 1 SOL + 交易费），请先注资");
    process.exit(1);
  }

  const policyExists = await connection.getAccountInfo(policyPda);
  if (!policyExists) {
    const sig = await program.methods
      .initialize(agent.publicKey, new anchor.BN(MAX_PER_TX), new anchor.BN(DAILY_LIMIT), [])
      .accounts({ authority: authority.publicKey })
      .signers([authority])
      .rpc();
    console.log(`  ① initialize（限额 0.1/笔、1/天）→ ${link(sig)}`);
  } else {
    console.log("  ① policy 已存在，跳过 initialize");
  }

  const before = await connection.getBalance(vaultPda);
  if (before < LAMPORTS_PER_SOL) {
    const sig = await program.methods
      .deposit(new anchor.BN(LAMPORTS_PER_SOL))
      .accounts({ depositor: agent.publicKey })
      .signers([agent])
      .rpc();
    console.log(`  ② deposit 1 SOL → ${link(sig)}`);
    console.log(`     金库余额：${(await connection.getBalance(vaultPda)) / LAMPORTS_PER_SOL} SOL`);
  } else {
    console.log("  ② 金库已有 ≥1 SOL，跳过 deposit");
  }

  const destination = Keypair.generate().publicKey;

  try {
    await program.methods
      .withdraw(new anchor.BN(0.2 * LAMPORTS_PER_SOL))
      .accounts({ agent: agent.publicKey, destination })
      .signers([agent])
      .rpc();
    console.error("  ✗ 预期 AmountExceeded 被拒绝，但交易居然成功了");
    process.exit(1);
  } catch (err) {
    const msg = String(err);
    const isExceeded = msg.includes("AmountExceeded") || msg.includes("0x1770");
    const logSig = msg.match(/"signature":"([^"]+)"/)?.[1];
    console.log(
      `  ③ withdraw 0.2 SOL（超单笔限额）→ 链上拒绝 ${isExceeded ? "AmountExceeded" : "(错误码未匹配，请人工核对)"}`,
    );
    if (logSig) console.log(`     被拒交易（validator 已执行并 revert）→ ${link(logSig)}`);
  }

  const sig = await program.methods
    .withdraw(new anchor.BN(0.05 * LAMPORTS_PER_SOL))
    .accounts({ agent: agent.publicKey, destination })
    .signers([agent])
    .rpc();
  const after = await connection.getBalance(vaultPda);
  console.log(`  ④ withdraw 0.05 SOL（限额内）→ 成功 ${link(sig)}`);
  console.log(`     金库余额变化：${before / LAMPORTS_PER_SOL} → ${after / LAMPORTS_PER_SOL} SOL`);

  const vs = await (program.account as any).vaultState.fetch(vaultStatePda);
  console.log(`     24h 窗口已支出：${(vs.spentInWindow.toNumber() / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  console.log(`\n${line}`);
  console.log("  ✅ 链上冒烟完成 —— 以上 explorer 链接即为链上证据，可截图存档");
  console.log(line);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
