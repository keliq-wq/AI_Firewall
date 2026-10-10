/**
 * 第 3 层集成测试（需要：已部署的程序 + 任意 RPC）。
 * 运行（本地验证器或 testnet/devnet 经 rpc-proxy）：
 *   ANCHOR_PROVIDER_URL=<rpc> ANCHOR_WALLET=~/.config/solana/id.json \
 *   FAUCET_KEYPAIR=<已注资钱包> npx ts-mocha -t 1000000 programs/firewall/tests/firewall.ts
 *
 * 全部交易走手动 send + HTTP 轮询确认（scripts/tx-confirm.ts）：
 * 经本地 rpc-proxy 转发时 WebSocket 订阅对「订阅前已处理」的交易不补发通知，竞态必输。
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { confirmHttp, getLatestBlockhashRetry, sendRawTransactionRetry } from "../../../scripts/tx-confirm";
import idl from "../target/idl/firewall.json";

// 链上错误码（errors.rs 顺序 + anchor 6000 偏移）
const CODE = {
  AmountExceeded: 6000,
  ZeroAmount: 6001,
  DailyLimitExceeded: 6002,
  ProgramNotAllowed: 6003,
  UnauthorizedAgent: 6004,
} as const;

describe("firewall（第 3 层：链上策略强制金库）", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  // 程序 ID 取自 IDL 的 address 字段（单一事实来源）：
  // Windows 下 anchor build 无法生成 target/types，且 ID 会在 keypair 轮换后变化，避免硬编码
  const program = new Program(idl as any, provider);

  /**
   * 注资：优先用 FAUCET_KEYPAIR（本地验证器的 faucet 密钥 / testnet 已注资钱包）直接转账——
   * Windows 上 test-validator 的 requestAirdrop 有已知 bug，一律 Internal error。
   */
  let faucet: Keypair | null = null;
  if (process.env.FAUCET_KEYPAIR && existsSync(process.env.FAUCET_KEYPAIR)) {
    faucet = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(process.env.FAUCET_KEYPAIR, "utf-8")) as number[]),
    );
  }
  async function fund(pubkey: PublicKey, lamports: number): Promise<void> {
    if (faucet) {
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: faucet.publicKey, toPubkey: pubkey, lamports }),
      );
      tx.feePayer = faucet.publicKey;
      tx.recentBlockhash = (await getLatestBlockhashRetry(provider.connection)).blockhash;
      tx.sign(faucet);
      const sig = await sendRawTransactionRetry(provider.connection, tx);
      const r = await confirmHttp(provider.connection, sig);
      if (r.err) {
        throw new Error(`注资失败 ${pubkey.toBase58()}: ${JSON.stringify(r.err)}`);
      }
    } else {
      const sig = await provider.connection.requestAirdrop(pubkey, lamports);
      await confirmHttp(provider.connection, sig);
    }
  }

  /** anchor 指令构建器 → 手动签名发送 + HTTP 确认；返回 { signature, err }（链上失败不抛） */
  async function sendProgramTx(
    builder: { transaction: () => Promise<Transaction> },
    signers: Keypair[],
  ): Promise<{ signature: string; err: unknown }> {
    const tx = await builder.transaction();
    tx.feePayer = provider.wallet.publicKey;
    tx.recentBlockhash = (await getLatestBlockhashRetry(provider.connection)).blockhash;
    tx.sign(...signers);
    await provider.wallet.signTransaction(tx); // fee payer 签名
    const signature = await sendRawTransactionRetry(provider.connection, tx);
    return confirmHttp(provider.connection, signature);
  }

  // 持久化 authority/agent 密钥（scripts/keys/）：重跑时复用余额，避免每次烧新 SOL
  const keysDir = `${__dirname}/../../../scripts/keys`;
  function loadOrCreateKey(name: string): Keypair {
    const path = `${keysDir}/${name}.json`;
    if (existsSync(path)) {
      return Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")) as number[]),
      );
    }
    const kp = Keypair.generate();
    mkdirSync(keysDir, { recursive: true });
    writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
    return kp;
  }
  const authority = loadOrCreateKey("test-authority");
  const agent = loadOrCreateKey("test-agent");
  const destination = Keypair.generate();

  const [policyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), authority.publicKey.toBuffer()],
    program.programId,
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), authority.publicKey.toBuffer()],
    program.programId,
  );
  const [vaultStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-state"), authority.publicKey.toBuffer()],
    program.programId,
  );

  const MAX_PER_TX = 5 * LAMPORTS_PER_SOL;
  const DAILY_LIMIT = 10 * LAMPORTS_PER_SOL;
  const DEPOSIT = 0.5 * LAMPORTS_PER_SOL;

  before(async () => {
    // 注资最小化(水龙头限流严重):authority 只覆盖 PDA 租金+费用,agent 覆盖 deposit 0.5+费用
    const [authBal, agentBal] = await Promise.all([
      provider.connection.getBalance(authority.publicKey),
      provider.connection.getBalance(agent.publicKey),
    ]);
    if (authBal < 0.1 * LAMPORTS_PER_SOL) await fund(authority.publicKey, 0.1 * LAMPORTS_PER_SOL);
    if (agentBal < 0.55 * LAMPORTS_PER_SOL) await fund(agent.publicKey, 0.55 * LAMPORTS_PER_SOL);
    // 幂等：policy 已存在则跳过初始化（持久化密钥重跑场景）
    const policyExists = await provider.connection.getAccountInfo(policyPda);
    if (!policyExists) {
      const r = await sendProgramTx(
        program.methods
          .initialize(agent.publicKey, new anchor.BN(MAX_PER_TX), new anchor.BN(DAILY_LIMIT), [])
          .accounts({
            authority: authority.publicKey,
            policy: policyPda,
            vault_state: vaultStatePda,
            vault: vaultPda,
          })
          .signers([authority]),
        [authority],
      );
      expect(r.err).to.eq(null);
    }
  });

  it("deposit：Agent 入金成功，金库余额增加", async () => {
    // 幂等：金库余额已够则跳过入金（重跑不重复烧 SOL）
    const vaultBal = await provider.connection.getBalance(vaultPda);
    if (vaultBal < DEPOSIT) {
      const r = await sendProgramTx(
        program.methods
          .deposit(new anchor.BN(DEPOSIT))
          .accounts({ depositor: agent.publicKey, policy: policyPda, vault: vaultPda })
          .signers([agent]),
        [agent],
      );
      expect(r.err).to.eq(null);
    }
    const balance = await provider.connection.getBalance(vaultPda);
    expect(balance).to.be.gte(DEPOSIT);
  });

  it("withdraw：超单笔限额被链上拒绝（AmountExceeded）", async () => {
    const r = await sendProgramTx(
      program.methods
        .withdraw(new anchor.BN(MAX_PER_TX + 1))
        .accounts({
          agent: agent.publicKey,
          destination: destination.publicKey,
          policy: policyPda,
          vault_state: vaultStatePda,
          vault: vaultPda,
        })
        .signers([agent]),
      [agent],
    );
    expect(JSON.stringify(r.err)).to.contain(String(CODE.AmountExceeded));
  });

  it("withdraw：非登记 Agent 被拒绝（密钥对金库零权限）", async () => {
    const attacker = Keypair.generate();
    await fund(attacker.publicKey, 0.02 * LAMPORTS_PER_SOL);
    const r = await sendProgramTx(
      program.methods
        .withdraw(new anchor.BN(1000))
        .accounts({
          agent: attacker.publicKey,
          destination: destination.publicKey,
          policy: policyPda,
          vault_state: vaultStatePda,
          vault: vaultPda,
        })
        .signers([attacker]),
      [attacker],
    );
    expect(JSON.stringify(r.err)).to.contain(String(CODE.UnauthorizedAgent));
  });

  it("withdraw：限额内成功，滚动窗口记账更新", async () => {
    const r = await sendProgramTx(
      program.methods
        .withdraw(new anchor.BN(0.25 * LAMPORTS_PER_SOL))
        .accounts({
          agent: agent.publicKey,
          destination: destination.publicKey,
          policy: policyPda,
          vault_state: vaultStatePda,
          vault: vaultPda,
        })
        .signers([agent]),
      [agent],
    );
    expect(r.err).to.eq(null);
    const vs = await (program.account as any).vaultState.fetch(vaultStatePda);
    expect(vs.spentInWindow.toNumber()).to.be.gte(0.25 * LAMPORTS_PER_SOL);
  });

  it("withdraw：累计超过 24h 上限被拒绝（DailyLimitExceeded）", async () => {
    // 当前窗口已支出 0.25 SOL；再提 9.75 SOL → 累计 10 > 10 上限（金额检查先于余额转移，金库余额无关）
    const r = await sendProgramTx(
      program.methods
        .withdraw(new anchor.BN(9.75 * LAMPORTS_PER_SOL))
        .accounts({
          agent: agent.publicKey,
          destination: destination.publicKey,
          policy: policyPda,
          vault_state: vaultStatePda,
          vault: vaultPda,
        })
        .signers([agent]),
      [agent],
    );
    expect(JSON.stringify(r.err)).to.contain(String(CODE.DailyLimitExceeded));
  });

  it("execute：非白名单协议被拒绝（ProgramNotAllowed）", async () => {
    const rogue = Keypair.generate().publicKey;
    const r = await sendProgramTx(
      program.methods
        .execute(new anchor.BN(1000), Buffer.alloc(0))
        .accounts({
          agent: agent.publicKey,
          targetProgram: rogue,
          destination: destination.publicKey,
          policy: policyPda,
          vault_state: vaultStatePda,
          vault: vaultPda,
        })
        .signers([agent]),
      [agent],
    );
    expect(JSON.stringify(r.err)).to.contain(String(CODE.ProgramNotAllowed));
  });
});
