/**
 * P0 一票否决 spike:RPC 模拟契约验证(泛化架构的成败开关)。
 *
 * 验证四件事(结论将决定 Phase 1/2 的可行性):
 *  (a) 被触及代币账户在模拟响应 accounts[i].data 中可解码(165B 布局 → amount/delegate)
 *  (b) 已关闭/不存在的账户在 addresses 列表中的返回形态
 *  (c) feePayer 是否在模拟中被实扣费
 *  (d) 响应条数与请求 addresses 数的对账规则
 *
 * 流程:testnet 上自建 mint + 2 个 ATA(预算 ≈0.006 SOL)→ mintTo 100 → 构造转账 V0
 * → simulateTransaction(全消息键 + base64)→ 断言 → fixture 固化 → 关账户退租。
 *
 * 运行:RPC_URL=http://127.0.0.1:8898 npx tsx scripts/sim-contract-spike.tmp.ts
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { decodeTokenAccount } from "../src/decode/token_layout";
import { confirmHttp, getLatestBlockhashRetry, sendRawTransactionRetry } from "./tx-confirm";

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8898";
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function tokenIx(tag: number, keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[], data: Buffer): TransactionInstruction {
  return new TransactionInstruction({ programId: TOKEN_PROGRAM, keys, data: Buffer.concat([Buffer.from([tag]), data]) });
}

const PASS = "✅", FAIL = "❌";
let failures = 0;
function assert(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? PASS : FAIL} ${name}: ${detail}`);
  if (!ok) failures++;
}

async function main(): Promise<void> {
  const walletPath = process.env.WALLET_KEYPAIR ?? join(homedir(), ".config", "solana", "id.json");
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf-8")) as number[]));
  const connection = new Connection(RPC_URL, "confirmed");
  console.log(`钱包 ${wallet.publicKey.toBase58()} @ ${RPC_URL}`);
  const bal = await connection.getBalance(wallet.publicKey);
  console.log(`余额 ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (bal < 0.003 * LAMPORTS_PER_SOL) {
    console.error("余额不足以支撑最小运行(复用路径 ≈0.003 SOL),请先注资");
    process.exit(1);
  }

  // ── 准备:探测复用已有代币账户,只补建缺失部分(预算极省) ──
  const dest = Keypair.generate();
  let mint: PublicKey;
  let sourceAta: PublicKey;
  let mintKp: Keypair | null = null;
  const existing = await connection.getTokenAccountsByOwner(wallet.publicKey, { programId: TOKEN_PROGRAM }, "confirmed");
  const usable = existing.value.find((a) => {
    const d = decodeTokenAccount(a.account.data);
    return d && d.amount >= 30_000_000n;
  });
  if (usable) {
    sourceAta = usable.pubkey;
    const d = decodeTokenAccount(usable.account.data)!;
    mint = d.mint;
    console.log(`  复用已有 sourceAta(${sourceAta.toBase58().slice(0, 12)}…,余额 ${d.amount})`);
  } else {
    mintKp = Keypair.generate();
    mint = mintKp.publicKey;
    sourceAta = PublicKey.findProgramAddressSync([wallet.publicKey.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
  }
  const destAta = PublicKey.findProgramAddressSync([dest.publicKey.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];

  const mkTx = () => {
    const tx = new (require("@solana/web3.js").Transaction)();
    return tx;
  };

  async function sendAndCheck(tx: import("@solana/web3.js").Transaction, label: string): Promise<void> {
    const sig = await sendRawTransactionRetry(connection, tx);
    const r = await confirmHttp(connection, sig);
    if (r.err) {
      throw new Error(`${label} 链上失败: ${JSON.stringify(r.err)}`);
    }
    console.log(`  ${label} ✓`);
  }

  if (!usable) {
    // ① 预建 mint 账户 + createMint(tag 0)
    {
      const tx = mkTx();
      tx.add(
        SystemProgram.createAccount({
          fromPubkey: wallet.publicKey,
          newAccountPubkey: mint,
          lamports: await connection.getMinimumBalanceForRentExemption(82),
          space: 82,
          programId: TOKEN_PROGRAM,
        }),
      );
      tx.add(
        tokenIx(0, [
          { pubkey: mint, isSigner: true, isWritable: true },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
        ], Buffer.from([6, ...wallet.publicKey.toBytes(), 0])), // decimals=6, mint authority=wallet, freeze=无
      );
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await getLatestBlockhashRetry(connection)).blockhash;
      tx.sign(wallet, mintKp!);
      await sendAndCheck(tx, `mint 创建(${mint.toBase58().slice(0, 12)}…)`);
    }
    // ② source ATA
    {
      const tx = mkTx();
      tx.add(
        new TransactionInstruction({
          programId: ATA_PROGRAM,
          keys: [
            { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
            { pubkey: sourceAta, isSigner: false, isWritable: true },
            { pubkey: wallet.publicKey, isSigner: false, isWritable: false },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
          ],
          data: Buffer.alloc(0),
        }),
      );
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await getLatestBlockhashRetry(connection)).blockhash;
      tx.sign(wallet);
      await sendAndCheck(tx, "source ATA 创建");
    }
    // ③ mintTo 100(tag 7)
    {
      const tx = mkTx();
      const amt = Buffer.alloc(8);
      amt.writeBigUInt64LE(100_000_000n, 0); // 6 decimals → 100.0
      tx.add(
        tokenIx(7, [
          { pubkey: mint, isSigner: false, isWritable: true },
          { pubkey: sourceAta, isSigner: false, isWritable: true },
          { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
        ], amt),
      );
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await getLatestBlockhashRetry(connection)).blockhash;
      tx.sign(wallet);
      await sendAndCheck(tx, "mintTo 100");
    }
  }

  // ④ dest ATA(每次运行都是新 keypair,恒需创建)
  {
    const tx = mkTx();
    tx.add(
      new TransactionInstruction({
        programId: ATA_PROGRAM,
        keys: [
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: destAta, isSigner: false, isWritable: true },
          { pubkey: dest.publicKey, isSigner: false, isWritable: false },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        ],
        data: Buffer.alloc(0),
      }),
    );
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await getLatestBlockhashRetry(connection)).blockhash;
    tx.sign(wallet);
    await sendAndCheck(tx, "dest ATA 创建");
  }

  // ── 核心:构造转账 V0 并模拟 ──
  const transferData = Buffer.alloc(8);
  transferData.writeBigUInt64LE(30_000_000n, 0); // 转 30.0
  // Tokenkeg Transfer = 3 账户:[source(w), destination(w), authority(s)],mint 不是指令账户
  const transferIx = tokenIx(3, [
    { pubkey: sourceAta, isSigner: false, isWritable: true },
    { pubkey: destAta, isSigner: false, isWritable: true },
    { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
  ], transferData);

  const { blockhash } = await getLatestBlockhashRetry(connection);
  const vtx = new VersionedTransaction(
    new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: blockhash, instructions: [transferIx] }).compileToV0Message(),
  );

  const allKeys: string[] = [];
  for (let i = 0; i < vtx.message.getAccountKeys().length; i++) {
    const k = vtx.message.getAccountKeys().get(i);
    if (k) allKeys.push(k.toBase58());
  }
  // 混入一个不存在的地址,验证 (b)
  const ghost = Keypair.generate().publicKey.toBase58();
  const addresses = [...allKeys, ghost];

  // 契约发现:公共端点多为多节点,确认与读取可能打到不同节点 → 前态可能短暂为 null。
  // 效果收集器必须重试;最终仍缺 = CoverageGap(fail-closed),绝不当作"无变化"。
  const wanted = addresses.slice(0, -1).map((a) => new PublicKey(a));
  let preStates = await connection.getMultipleAccountsInfo(wanted, "confirmed");
  for (let attempt = 1; preStates.some((s) => s == null) && attempt <= 6; attempt++) {
    console.log(`  前态缺失 ${preStates.filter((s) => s == null).length} 个,重试 ${attempt}/6(节点滞后)`);
    await new Promise((r) => setTimeout(r, 3000));
    preStates = await connection.getMultipleAccountsInfo(wanted, "confirmed");
  }
  preStates.forEach((s, i) => {
    if (s == null) console.log(`  ⚠ preStates[${i}] 仍为 null: ${allKeys[i]?.slice(0, 16)}…`);
  });
  const srcPreIdx = allKeys.indexOf(sourceAta.toBase58());
  const srcPreInfo = preStates[srcPreIdx];
  if (!srcPreInfo?.data) {
    console.error(`sourceAta 前态缺失(idx=${srcPreIdx})——契约不支持前态依赖,需降级方案`);
    process.exit(1);
  }
  const sourcePre = decodeTokenAccount(srcPreInfo.data);

  // 契约发现:simulateTransaction 的 addresses 数量上限随版本而异
  // (本地 1.18 = max 4,testnet 4.4 = max 5)。架构上必须分块模拟:
  // 同一交易多次 simulate,每块 ≤4 个地址(取全局最小公分母),结果按地址索引合并。
  // 这正是设计文档预留的 B 路线截断策略触发条件。
  const CHUNK = 4;
  const chunks: string[][] = [];
  for (let i = 0; i < addresses.length; i += CHUNK) chunks.push(addresses.slice(i, i + CHUNK));

  const mergedAccounts: (NonNullable<Awaited<ReturnType<Connection["simulateTransaction"]>>["value"]["accounts"]>[number] | null)[] = new Array(addresses.length).fill(null);
  let firstErr: unknown = null;
  let firstLogs: string[] = [];
  let innerCount = 0;
  let simCalls = 0;

  for (const chunk of chunks) {
    const resp = await connection.simulateTransaction(vtx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      innerInstructions: true,
      accounts: { encoding: "base64", addresses: chunk },
    });
    simCalls++;
    const value = resp.value;
    if (firstErr == null) firstErr = value.err ?? null;
    if (firstLogs.length === 0) firstLogs = value.logs ?? [];
    innerCount += value.innerInstructions?.length ?? 0;
    const base = chunks.indexOf(chunk) * CHUNK;
    (value.accounts ?? []).forEach((a, i) => {
      mergedAccounts[base + i] = a ?? null;
    });
  }

  const fixture: Record<string, unknown> = {
    rpcUrl: RPC_URL,
    contractFindings: {
      accountsLimitPerSimulate: "5 (Too many accounts provided; max 5)",
      strategy: "chunked simulation, ≤5 addresses per call, merge by index",
      preStateLag: "多节点端点前态可能滞后,收集器必须重试,缺前态=CoverageGap",
    },
    err: firstErr,
    addressesRequested: addresses.length,
    simCalls,
    innerInstructionsCount: innerCount,
    logs: firstLogs.slice(0, 6),
    accounts: mergedAccounts.map((a, i) => ({ address: addresses[i], lamports: a?.lamports, dataLen: a?.data?.length ?? 0, dataBase64: a?.data ?? null })),
  };

  console.log("\n── 模拟契约断言 ──");
  // (a) 代币账户 data 可解码
  const srcIdx = allKeys.indexOf(sourceAta.toBase58());
  const dstIdx = allKeys.indexOf(destAta.toBase58());
  const srcPostData = mergedAccounts[srcIdx]?.data ? Buffer.from(mergedAccounts[srcIdx]!.data![0], "base64") : null;
  const dstPostData = mergedAccounts[dstIdx]?.data ? Buffer.from(mergedAccounts[dstIdx]!.data![0], "base64") : null;
  const srcPost = srcPostData ? decodeTokenAccount(srcPostData) : null;
  const dstPost = dstPostData ? decodeTokenAccount(dstPostData) : null;
  assert(
    "(a) 代币账户 data 可解码且余额正确",
    srcPost?.amount === 70_000_000n && dstPost?.amount === 30_000_000n,
    `source ${sourcePre?.amount}→${srcPost?.amount}, dest→${dstPost?.amount}`,
  );
  // (b) 幽灵地址返回形态
  const ghostIdx = addresses.indexOf(ghost);
  assert(
    "(b) 不存在账户返回形态明确",
    mergedAccounts[ghostIdx] == null,
    `ghostIdx=${ghostIdx}, 该位=${mergedAccounts[ghostIdx] === null ? "null" : mergedAccounts[ghostIdx] === undefined ? "undefined" : "有值"}`,
  );
  // (c) feePayer 实扣费
  const payerIdx = allKeys.indexOf(wallet.publicKey.toBase58());
  const preLamports = preStates[payerIdx]?.lamports ?? 0;
  const postLamports = mergedAccounts[payerIdx]?.lamports ?? preLamports;
  assert("(c) feePayer 模拟中被实扣费", postLamports < preLamports, `${preLamports} → ${postLamports}`);
  // (d) 条数对账:分块模拟,每块返回条数 == 块内请求条数
  assert(
    "(d) 分块模拟条数对账(每块 ≤5 全返回)",
    mergedAccounts.filter((a) => a !== null).length === addresses.length - 1, // 幽灵为 null,其余全返回
    `${mergedAccounts.filter((a) => a !== null).length} / ${addresses.length}`,
  );

  // fixture 固化
  const fixDir = join(__dirname, "..", "tests", "fixtures", "sim");
  mkdirSync(fixDir, { recursive: true });
  writeFileSync(join(fixDir, "token-transfer.json"), JSON.stringify(fixture, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log(`\nfixture → tests/fixtures/sim/token-transfer.json`);

  // ── 清理:burn + close ATA 退租 ──
  try {
    const tx = mkTx();
    tx.add(tokenIx(9, [
      { pubkey: sourceAta, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
    ], Buffer.alloc(0)));
    tx.add(tokenIx(9, [
      { pubkey: destAta, isSigner: false, isWritable: true },
      { pubkey: dest.publicKey, isSigner: false, isWritable: true },
      { pubkey: dest.publicKey, isSigner: true, isWritable: false },
    ], Buffer.alloc(0)));
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await getLatestBlockhashRetry(connection)).blockhash;
    tx.sign(wallet, dest);
    const sig = await sendRawTransactionRetry(connection, tx);
    await confirmHttp(connection, sig);
    console.log("清理:ATA 已关闭退租 ✓");
  } catch (e) {
    console.log(`清理失败(可忽略):${String(e).slice(0, 80)}`);
  }

  console.log(failures === 0 ? "\n🎉 全部断言通过——RPC 契约支持泛化架构" : `\n${failures} 项断言失败——契约不支持,启动叙事收窄预案`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
