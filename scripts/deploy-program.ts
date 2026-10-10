/**
 * 通过 node/web3.js 部署防火墙程序（BPFLoaderUpgradeable）——绕开本机 solana CLI
 * （reqwest 出站拨号坏，详见 docs/ONLINE-TESTING.md）与 Windows 下不可用的 anchor build。
 *
 * 本地 / Devnet 通用：
 *   FAUCET_KEYPAIR=/d/test-ledger/faucet-keypair.json npx tsx scripts/deploy-program.ts http://127.0.0.1:8899
 *   npx tsx scripts/deploy-program.ts https://solana-devnet.g.alchemy.com/v2/demo ~/.config/solana/id.json
 *
 * 支付者：参数 2 指定密钥文件路径；缺省依次取 FAUCET_KEYPAIR（本地验证器）→ ~/.config/solana/id.json。
 * 部署权限（buffer/programdata 的 upgrade authority）属于 target/deploy/firewall-keypair.json。
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { readFileSync, existsSync } from "fs";
import { confirmHttp, getLatestBlockhashRetry, sendRawTransactionRetry } from "./tx-confirm";
import { homedir } from "os";
import { join } from "path";

const RPC_URL = process.argv[2] ?? "http://127.0.0.1:8899";
const PROGRAM_KEYPAIR = join(__dirname, "..", "target", "deploy", "firewall-keypair.json");
const SO_PATH = join(__dirname, "..", "target", "deploy", "firewall.so");

// 与 cargo-build-sbf 输出路径对应；未找到时回退 program 目录下（旧布局）
const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

function loadKp(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")) as number[]));
}

async function main(): Promise<void> {
  const programKp = loadKp(PROGRAM_KEYPAIR);
  const so = readFileSync(SO_PATH);
  console.log(`程序 ${programKp.publicKey.toBase58()}（.so ${so.length} 字节）→ ${RPC_URL}`);

  const payerPath =
    process.argv[3] ?? process.env.FAUCET_KEYPAIR ?? join(homedir(), ".config", "solana", "id.json");
  if (!existsSync(payerPath)) {
    console.error(`支付者密钥不存在: ${payerPath}`);
    process.exit(1);
  }
  const payer = loadKp(payerPath);
  console.log(`支付者 ${payer.publicKey.toBase58()}`);

  const connection = new Connection(RPC_URL, "confirmed");
  const payerBal = await connection.getBalance(payer.publicKey);
  console.log(`支付者余额 ${(payerBal / 1e9).toFixed(3)} SOL`);

  const [programDataPda] = PublicKey.findProgramAddressSync(
    [programKp.publicKey.toBuffer()],
    BPF_LOADER_UPGRADEABLE,
  );

  // 清理上次失败部署的残留(loader 拥有的 Uninitialized 账户可用 Close 指令关闭)
  const closeData = Buffer.alloc(4);
  closeData.writeUInt32LE(5, 0); // Close
  const existing = await connection.getAccountInfo(programKp.publicKey);
  if (existing?.executable) {
    console.log("程序已部署且可执行,跳过");
    return;
  }
  if (existing?.owner.equals(BPF_LOADER_UPGRADEABLE)) {
    console.log("清理残留程序账户...");
    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: BPF_LOADER_UPGRADEABLE,
        keys: [
          { pubkey: programKp.publicKey, isWritable: true, isSigner: false },
          { pubkey: payer.publicKey, isWritable: true, isSigner: false },
        ],
        data: closeData,
      }),
    );
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await getLatestBlockhashRetry(connection)).blockhash;
    tx.sign(payer);
    const sig = await sendRawTransactionRetry(connection, tx);
    await confirmHttp(connection, sig);
    console.log(`  已关闭残留程序账户 ${sig}`);
  } else if (existing) {
    console.error("目标地址已存在非程序账户,部署会冲突;请检查或换 keypair");
    process.exit(1);
  }
  const existingData = await connection.getAccountInfo(programDataPda);
  if (existingData?.owner.equals(BPF_LOADER_UPGRADEABLE)) {
    console.log("清理残留 programdata 账户...");
    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: BPF_LOADER_UPGRADEABLE,
        keys: [
          { pubkey: programDataPda, isWritable: true, isSigner: false },
          { pubkey: payer.publicKey, isWritable: true, isSigner: false },
        ],
        data: closeData,
      }),
    );
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await getLatestBlockhashRetry(connection)).blockhash;
    tx.sign(payer);
    const sig = await sendRawTransactionRetry(connection, tx);
    await confirmHttp(connection, sig);
    console.log(`  已关闭残留 programdata 账户 ${sig}`);
  }

  // Buffer 元数据 37 字节、程序账户 36 字节;ProgramData 由 loader 在 deploy 时用 PDA 签名自建
  const bufferKp = Keypair.generate();
  const bufferSpace = 37 + so.length;
  const programAccountSpace = 36; // UpgradeableLoaderState::size_of_program()

  const [bufferRent, programRent] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(bufferSpace),
    connection.getMinimumBalanceForRentExemption(programAccountSpace),
  ]);

  const txs: { tx: Transaction; signers: Keypair[] }[] = [];
  const makeTx = (ixs: TransactionInstruction[], signers: Keypair[]) => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = payer.publicKey;
    txs.push({ tx, signers: [payer, ...signers] });
  };

  // ① 创建 Buffer 与程序账户(36 字节 Uninitialized,deploy 前必须由调用方预创建)
  makeTx(
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: bufferKp.publicKey,
        lamports: bufferRent,
        space: bufferSpace,
        programId: BPF_LOADER_UPGRADEABLE,
      }),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: programKp.publicKey,
        lamports: programRent,
        space: programAccountSpace,
        programId: BPF_LOADER_UPGRADEABLE,
      }),
    ],
    [bufferKp, programKp],
  );

  // ② InitializeBuffer:tag=0(u32 fixint),authority 设为 buffer 自身
  const initData = Buffer.alloc(4);
  initData.writeUInt32LE(0, 0);
  makeTx(
    [
      new TransactionInstruction({
        programId: BPF_LOADER_UPGRADEABLE,
        keys: [
          { pubkey: bufferKp.publicKey, isWritable: true, isSigner: false },
          { pubkey: bufferKp.publicKey, isWritable: false, isSigner: false },
        ],
        data: initData,
      }),
    ],
    [],
  );

  // ③ 写 Buffer:bincode fixint 布局 tag=1(u32) + offset(u32) + Vec<u8>(u64 长度 + 数据),每块 900 字节
  const CHUNK = 900;
  for (let offset = 0; offset < so.length; offset += CHUNK) {
    const chunk = so.subarray(offset, offset + CHUNK);
    const head = Buffer.alloc(16);
    head.writeUInt32LE(1, 0); // Write
    head.writeUInt32LE(offset, 4);
    head.writeBigUInt64LE(BigInt(chunk.length), 8); // bincode Vec 长度
    makeTx(
      [
        new TransactionInstruction({
          programId: BPF_LOADER_UPGRADEABLE,
          keys: [
            { pubkey: bufferKp.publicKey, isWritable: true, isSigner: false },
            { pubkey: bufferKp.publicKey, isWritable: false, isSigner: true }, // buffer authority
          ],
          data: Buffer.concat([head, chunk]),
        }),
      ],
      [bufferKp],
    );
  }

  // ④ DeployWithMaxDataLen:tag=2(u32) + max_data_len(u64),8 账户(1.18 布局)
  const deployData = Buffer.alloc(12);
  deployData.writeUInt32LE(2, 0);
  deployData.writeBigUInt64LE(BigInt(so.length), 4);
  makeTx(
    [
      new TransactionInstruction({
        programId: BPF_LOADER_UPGRADEABLE,
        keys: [
          { pubkey: payer.publicKey, isWritable: true, isSigner: true }, // 0 payer
          { pubkey: programDataPda, isWritable: true, isSigner: false }, // 1 programdata(loader 自建)
          { pubkey: programKp.publicKey, isWritable: true, isSigner: false }, // 2 program(已预创建)
          { pubkey: bufferKp.publicKey, isWritable: true, isSigner: false }, // 3 buffer
          { pubkey: SYSVAR_RENT_PUBKEY, isWritable: false, isSigner: false }, // 4
          { pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false }, // 5
          { pubkey: SystemProgram.programId, isWritable: false, isSigner: false }, // 6
          { pubkey: bufferKp.publicKey, isWritable: false, isSigner: true }, // 7 buffer authority
        ],
        data: deployData,
      }),
    ],
    [bufferKp],
  );

  // ⑤ Close Buffer:tag=5(u32),2 账户(1.18 布局),退还租金给支付者(closeData 已在清理段定义)
  makeTx(
    [
      new TransactionInstruction({
        programId: BPF_LOADER_UPGRADEABLE,
        keys: [
          { pubkey: bufferKp.publicKey, isWritable: true, isSigner: true }, // 关闭账户(自身 authority)
          { pubkey: payer.publicKey, isWritable: true, isSigner: false }, // recipient
        ],
        data: closeData,
      }),
    ],
    [bufferKp],
  );

  for (const [i, { tx, signers }] of txs.entries()) {
    tx.recentBlockhash = (await getLatestBlockhashRetry(connection)).blockhash;
    tx.sign(...signers);
    const sig = await sendRawTransactionRetry(connection, tx);
    await confirmHttp(connection, sig);
    if (i % 20 === 0) console.log(`  交易 ${i + 1}/${txs.length} 已确认: ${sig}`);
  }

  const deployed = await connection.getAccountInfo(programKp.publicKey);
  if (!deployed?.executable) {
    console.error("✗ 部署后程序不可执行,请检查");
    process.exit(1);
  }
  console.log(`✅ 部署成功: ${programKp.publicKey.toBase58()} (executable, ${deployed.data.length} 字节)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
