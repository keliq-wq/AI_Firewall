/**
 * 验收测试来源：探针 tests/__auditorB2b-spl-drain-probe.tmp.test.ts（写于 2026-10-10，早于 P2/P3 修复）。
 *
 * 探针在 legacy 路径的断言（小额 SOL 声明掩护 TransferChecked 代币 drain 仍放行）属未修复缺口，
 * 未写入本测试，按流程记入 backlog。本文件落“V0 对照验收”：同一攻击结构在 V0 下由
 * 效果收集器 + I1 不变量拦截（3cc9077 / 270b6e1）。
 * 保留探针的 parser 断言：TransferChecked 的 raw 金额可离线解码（第 1 层可见、但金额不被门校验）。
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { parseTransaction } from "../src/parser";
import { Firewall } from "../src/validate";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const BPF_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const SYSTEM = SystemProgram.programId.toBase58();

/** 构造 165 字节 Token 账户（mint@0 owner@32 amount@64 delegate@72 state@108 delegated@121） */
function tokenState(opts: { owner: PublicKey; amount: bigint }): Buffer {
  const buf = Buffer.alloc(165);
  opts.owner.toBuffer().copy(buf, 32);
  buf.writeBigUInt64LE(opts.amount, 64);
  buf.writeUInt8(1, 108); // state = initialized
  return buf;
}

interface FakeState {
  lamports: number;
  owner: string;
  data: Buffer;
  executable: boolean;
}

/** 按地址回放的假 RPC（前/后态分离，尊重 addresses 分块协议） */
class FakeRpc {
  private readonly post = new Map<string, FakeState>();
  private readonly pre = new Map<string, FakeState>();

  set(addr: PublicKey, pre: FakeState, post: FakeState): void {
    this.pre.set(addr.toBase58(), pre);
    this.post.set(addr.toBase58(), post);
  }

  async simulateTransaction(
    _tx: unknown,
    config?: unknown,
  ): Promise<{ context: { slot: number }; value: Record<string, unknown> }> {
    const addresses = (config as { accounts?: { addresses?: string[] } })?.accounts?.addresses ?? [];
    const accounts = addresses.map((a) => {
      const s = this.post.get(a);
      return s
        ? {
            lamports: s.lamports,
            owner: s.owner,
            data: [s.data.toString("base64"), "base64"],
            executable: s.executable,
            rentEpoch: 0,
          }
        : null;
    });
    return {
      context: { slot: 1 },
      value: { err: null, accounts, logs: [], unitsConsumed: 1000, innerInstructions: [] },
    };
  }

  async getMultipleAccountsInfo(keys: PublicKey[]): Promise<unknown[]> {
    return keys.map((k) => {
      const s = this.pre.get(k.toBase58());
      return s
        ? { lamports: s.lamports, owner: new PublicKey(s.owner), data: s.data, executable: s.executable }
        : null;
    });
  }
}

describe("V0 对照验收：SPL 代币 drain 被 I1 不变量拦截（探针的 V0 侧）", () => {
  it("小额 SOL 声明（仅手续费）掩护 1e9 raw 代币转出 → INV_I1(high) strict deny", async () => {
    const wallet = Keypair.generate().publicKey;
    const attacker = Keypair.generate().publicKey;
    const sourceAta = Keypair.generate().publicKey;
    const destAta = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;

    // TransferChecked (type 12)：data = [12, amount u64 LE, decimals u8]
    const data = Buffer.alloc(10);
    data[0] = 12;
    data.writeBigUInt64LE(1_000_000_000n, 1);
    data[9] = 6;
    const ix = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: sourceAta, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: destAta, isSigner: false, isWritable: true },
        { pubkey: wallet, isSigner: true, isWritable: false },
      ],
      data,
    });
    const vtx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet,
        recentBlockhash: "1".repeat(32),
        instructions: [ix],
      }).compileToV0Message(),
    );

    // 第 1 层可见（raw 金额），但门不校验该价值——这是探针的观察，继续保留为断言
    const parsed = parseTransaction(vtx);
    expect(parsed.tokenTransfers).toHaveLength(1);
    expect(parsed.tokenTransfers[0]!.amount).toBe("1000000000");

    const fake = new FakeRpc();
    fake.set(
      wallet,
      { lamports: 1_000_000_000, owner: SYSTEM, data: Buffer.alloc(0), executable: false },
      { lamports: 999_995_000, owner: SYSTEM, data: Buffer.alloc(0), executable: false }, // 仅扣 5000 手续费
    );
    fake.set(
      sourceAta,
      { lamports: 2_039_280, owner: TOKEN_PROGRAM_ID.toBase58(), data: tokenState({ owner: wallet, amount: 1_000_000_000n }), executable: false },
      { lamports: 2_039_280, owner: TOKEN_PROGRAM_ID.toBase58(), data: tokenState({ owner: wallet, amount: 0n }), executable: false }, // 代币归零
    );
    fake.set(
      destAta,
      { lamports: 2_039_280, owner: TOKEN_PROGRAM_ID.toBase58(), data: tokenState({ owner: attacker, amount: 0n }), executable: false },
      { lamports: 2_039_280, owner: TOKEN_PROGRAM_ID.toBase58(), data: tokenState({ owner: attacker, amount: 1_000_000_000n }), executable: false },
    );
    fake.set(
      mint,
      { lamports: 1_461_600, owner: TOKEN_PROGRAM_ID.toBase58(), data: Buffer.alloc(82), executable: false },
      { lamports: 1_461_600, owner: TOKEN_PROGRAM_ID.toBase58(), data: Buffer.alloc(82), executable: false },
    );
    fake.set(
      TOKEN_PROGRAM_ID,
      { lamports: 1, owner: BPF_LOADER, data: Buffer.alloc(0), executable: true },
      { lamports: 1, owner: BPF_LOADER, data: Buffer.alloc(0), executable: true },
    );

    const fw = new Firewall(
      {
        amountUnit: "lamports",
        maxTransactionAmount: 1_000_000,
        confirmationThreshold: 1_000_000,
        dailyLimit: 100_000_000,
        simulationFeeTolerance: 5000,
      },
      { connection: fake as unknown as Connection },
    );
    const r = await fw.validateTransaction({
      action: "transfer",
      amount: 5000, // 声明金额 = 手续费（低配：以为在付手续费）
      purpose: "pay network fee",
      wallet: wallet.toBase58(),
      transaction: vtx,
    });

    const i1 = r.concerns.find((c) => c.id === "INV_I1");
    expect(i1?.severity).toBe("high");
    expect(r.shouldProceed).toBe(false);
    expect(r.requiresConfirmation).toBe(false);
    expect(r.tier).toBe("deny");
    expect(r.fingerprint).not.toBeNull();
    expect(r.decisions.find((d) => d.gate === "invariants")!.verdict).toBe("deny");
    // 假 RPC 按协议完整回应 → 拦截来自 I1 事实判定，而非 C1 完整性兜底
    expect(r.concerns.some((c) => c.id === "INV_C1")).toBe(false);
  });
});
