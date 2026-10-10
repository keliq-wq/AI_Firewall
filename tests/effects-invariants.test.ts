import { Connection, Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { EffectsCollector, EffectReport } from "../src/effects/collector";
import { INVARIANT_ERROR_CODES, runInvariants } from "../src/invariants/engine";
import { Firewall } from "../src";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const WALLET = Keypair.generate();
const MINT = Keypair.generate().publicKey;

/** 构造 165 字节 Token 账户(可指定 delegate) */
function tokenAccountState(opts: {
  amount: bigint;
  owner?: PublicKey;
  delegate?: PublicKey | null;
  delegatedAmount?: bigint;
  closeAuthority?: PublicKey | null;
  state?: number;
}): Buffer {
  const owner = opts.owner ?? WALLET.publicKey;
  const buf = Buffer.alloc(165);
  Buffer.from(MINT.toBytes()).copy(buf, 0);
  Buffer.from(owner.toBytes()).copy(buf, 32);
  buf.writeBigUInt64LE(opts.amount, 64);
  // delegate COption @72
  if (opts.delegate) {
    buf.writeUInt32LE(1, 72);
    Buffer.from(opts.delegate.toBytes()).copy(buf, 76);
  }
  buf.writeUInt8(opts.state ?? 1, 108);
  // is_native COption @109 = None
  buf.writeBigUInt64LE(opts.delegatedAmount ?? 0n, 121);
  if (opts.closeAuthority) {
    buf.writeUInt32LE(1, 129);
    Buffer.from(opts.closeAuthority.toBytes()).copy(buf, 133);
  }
  return buf;
}

interface FakeState {
  lamports: number;
  owner: string;
  data: Buffer;
  executable: boolean;
}

/** 按地址回放账户状态的假 RPC(前后态分离,尊重分块 addresses 参数) */
class FakeRpc {
  /** 模拟响应(post)状态 */
  states = new Map<string, FakeState>();
  /** getMultipleAccountsInfo(pre)状态 */
  preStates = new Map<string, FakeState>();
  inner = {
    index: 0,
    instructions: [
      {
        programIdIndex: 2, // 消息键 [wallet, ata, TOKEN_PROGRAM]
        accounts: [],
        data: Buffer.from([4, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64"), // inner Approve(tag 4)
      },
    ],
  };

  setState(addr: PublicKey, s: FakeState): void {
    this.states.set(addr.toBase58(), s);
    this.preStates.set(addr.toBase58(), s);
  }

  setPostState(addr: PublicKey, s: FakeState): void {
    this.states.set(addr.toBase58(), s);
  }

  async simulateTransaction(
    _tx: Transaction | VersionedTransaction,
    config: unknown,
  ): Promise<{ context: { slot: number }; value: Record<string, unknown> }> {
    const addresses = (config as { accounts?: { addresses?: string[] } })?.accounts?.addresses ?? [];
    const accounts = addresses.map((a) => {
      const s = this.states.get(a);
      if (!s) return null;
      return {
        lamports: s.lamports,
        owner: s.owner,
        data: [s.data.toString("base64"), "base64"],
        executable: s.executable,
        rentEpoch: 0,
        space: s.data.length,
      };
    });
    return {
      context: { slot: 1 },
      value: { err: null, accounts, logs: [], unitsConsumed: 1000, innerInstructions: [this.inner] },
    };
  }

  async getMultipleAccountsInfo(
    keys: PublicKey[],
  ): Promise<{ lamports: number; owner: PublicKey; data: Buffer; executable: boolean }[]> {
    return keys.map((k) => {
      const s = this.preStates.get(k.toBase58());
      return s ? { lamports: s.lamports, owner: new PublicKey(s.owner), data: s.data, executable: s.executable } : null;
    });
  }
}

function transferTx(): Transaction {
  const to = Keypair.generate().publicKey;
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: WALLET.publicKey, toPubkey: to, lamports: 1000 }));
  tx.feePayer = WALLET.publicKey;
  tx.recentBlockhash = "1".repeat(32);
  return tx;
}

describe("EffectsCollector — 分块模拟与事实提取", () => {
  it("提取代币余额 delta 与 Approve 突变(I2)", { timeout: 30000 }, async () => {
    const ata = Keypair.generate().publicKey;
    const attacker = Keypair.generate().publicKey;
    const fake = new FakeRpc();
    const pre = tokenAccountState({ amount: 100n });
    const post = tokenAccountState({ amount: 90n, delegate: attacker, delegatedAmount: 5n });
    fake.setState(ata, { lamports: 2039280, owner: TOKEN_PROGRAM.toBase58(), data: pre, executable: false });
    fake.setState(WALLET.publicKey, { lamports: 1000000, owner: SystemProgram.programId.toBase58(), data: Buffer.alloc(0), executable: false });
    fake.setState(TOKEN_PROGRAM, { lamports: 1, owner: "BPFLoaderUpgradeab1e11111111111111111111111", data: Buffer.alloc(0), executable: true });

    const collector = new EffectsCollector(fake as unknown as Connection);
    const tx = transferTx();
    // 交易不含 ata → 把 ata 注入模拟响应(fake 按 addresses 回放,addresses 来自交易键;
    // 这里通过第二段:单独测试 report 结构。为保持简单,直接把 ata 加进 fake 响应范围,
    // 用一枚包含 ata 的 V0 交易)
    const vtx = new VersionedTransaction(
      new (require("@solana/web3.js").TransactionMessage)({
        payerKey: WALLET.publicKey,
        recentBlockhash: "1".repeat(32),
        instructions: [
          new (require("@solana/web3.js").TransactionInstruction)({
            programId: TOKEN_PROGRAM,
            keys: [
              { pubkey: ata, isSigner: false, isWritable: true },
              { pubkey: WALLET.publicKey, isSigner: true, isWritable: false },
            ],
            data: Buffer.alloc(0),
          }),
        ],
      }).compileToV0Message(),
    );
    // 模拟后状态:ata 的 data 变为 post
    fake.setPostState(ata, { lamports: 2039280, owner: TOKEN_PROGRAM.toBase58(), data: post, executable: false });

    const report = await collector.collect(vtx);
    expect(report.completeness).toBe("complete");
    const ataDelta = report.tokenDeltas.find((d) => d.account === ata.toBase58());
    expect(ataDelta).toBeDefined();
    expect(ataDelta!.amountDelta).toBe(-10n);
    expect(ataDelta!.approveDetected).toBe(true);

    const violations = runInvariants(report, WALLET.publicKey.toBase58());
    expect(violations.some((v) => v.invariant === "I2" && v.message.includes("approval"))).toBe(true);
    expect(violations.some((v) => v.invariant === "I1")).toBe(true); // 代币净流出
    expect(violations.some((v) => v.invariant === "I4")).toBe(true); // 内层 Approve
  });

  it("幽灵地址与响应截断 → C1 fail-closed", { timeout: 30000 }, async () => {
    const fake = new FakeRpc();
    fake.setState(WALLET.publicKey, { lamports: 1000000, owner: SystemProgram.programId.toBase58(), data: Buffer.alloc(0), executable: false });
    fake.setState(TOKEN_PROGRAM, { lamports: 1, owner: "BPFLoaderUpgradeab1e11111111111111111111111", data: Buffer.alloc(0), executable: true });
    // 不给 ata 设状态 → fake 返回 null → 收集器标记缺失
    const ata = Keypair.generate().publicKey;
    const vtx = new VersionedTransaction(
      new (require("@solana/web3.js").TransactionMessage)({
        payerKey: WALLET.publicKey,
        recentBlockhash: "1".repeat(32),
        instructions: [
          new (require("@solana/web3.js").TransactionInstruction)({
            programId: TOKEN_PROGRAM,
            keys: [
              { pubkey: ata, isSigner: false, isWritable: true },
              { pubkey: WALLET.publicKey, isSigner: true, isWritable: false },
            ],
            data: Buffer.alloc(0),
          }),
        ],
      }).compileToV0Message(),
    );
    const collector = new EffectsCollector(fake as unknown as Connection);
    const report = await collector.collect(vtx);
    // 响应条数不足 → truncated(或 missing-pre)
    expect(report.completeness).not.toBe("complete");
  });
});

describe("Firewall 管线接入 — V0 不变量全链路", () => {
  it("V0 交易 + Approve 突变 → INV_I2 deny", { timeout: 30000 }, async () => {
    const ata = Keypair.generate().publicKey;
    const attacker = Keypair.generate().publicKey;
    const fake = new FakeRpc();
    const pre = tokenAccountState({ amount: 100n });
    const post = tokenAccountState({ amount: 100n, delegate: attacker });
    fake.setState(ata, { lamports: 2039280, owner: TOKEN_PROGRAM.toBase58(), data: pre, executable: false });
    fake.setState(WALLET.publicKey, { lamports: 1000000, owner: SystemProgram.programId.toBase58(), data: Buffer.alloc(0), executable: false });
    fake.setState(TOKEN_PROGRAM, { lamports: 1, owner: "BPFLoaderUpgradeab1e11111111111111111111111", data: Buffer.alloc(0), executable: true });
    fake.setPostState(ata, { lamports: 2039280, owner: TOKEN_PROGRAM.toBase58(), data: post, executable: false });

    const vtx = new VersionedTransaction(
      new (require("@solana/web3.js").TransactionMessage)({
        payerKey: WALLET.publicKey,
        recentBlockhash: "1".repeat(32),
        instructions: [
          new (require("@solana/web3.js").TransactionInstruction)({
            programId: TOKEN_PROGRAM,
            keys: [
              { pubkey: ata, isSigner: false, isWritable: true },
              { pubkey: WALLET.publicKey, isSigner: true, isWritable: false },
            ],
            data: Buffer.alloc(0),
          }),
        ],
      }).compileToV0Message(),
    );

    const fw = new Firewall({ mode: "strict" }, { connection: fake as unknown as Connection });
    const r = await fw.validateTransaction({
      action: "custom",
      purpose: "claim airdrop",
      wallet: WALLET.publicKey.toBase58(),
      transaction: vtx,
    });
    expect(r.shouldProceed).toBe(false);
    expect(r.concerns.some((c) => c.id === "INV_I2")).toBe(true);
  });
});

describe("P4 闭环 — 链上错误码 ↔ 不变量 ID", () => {
  it("6011 → I1,6012 → I2", () => {
    expect(INVARIANT_ERROR_CODES[6011]).toBe("I1");
    expect(INVARIANT_ERROR_CODES[6012]).toBe("I2");
  });
});

describe("runInvariants — 引擎纯函数", () => {
  it("C1 截断 → high 违规", () => {
    const report: EffectReport = {
      simErr: null,
      completeness: "truncated",
      feePayerDeltaLamports: 0,
      solDeltas: [],
      tokenDeltas: [],
      innerSensitiveHits: [],
    };
    const v = runInvariants(report);
    expect(v.some((x) => x.invariant === "C1" && x.severity === "high")).toBe(true);
  });

  it("无事实 → 零违规", () => {
    const report: EffectReport = {
      simErr: null,
      completeness: "complete",
      feePayerDeltaLamports: 0,
      solDeltas: [],
      tokenDeltas: [],
      innerSensitiveHits: [],
    };
    expect(runInvariants(report)).toHaveLength(0);
  });
});
