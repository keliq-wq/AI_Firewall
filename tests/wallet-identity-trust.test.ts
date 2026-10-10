/**
 * 验收测试来源：探针 tests/__auditor2b-wallet-probe.tmp.test.ts（写于 2026-10-10，早于 P2/P3 修复）。
 *
 * 反转（探针 E，依据 270b6e1 不变量引擎接线）：V0 + 诱饵 wallet + 假 RPC 未按分块协议
 * 完整回应时，效果收集器按“请求-响应条数”对账判定 truncated → INV_C1(high) → strict deny
 * （fail-closed；修复前该场景整体放行）。
 *
 * 探针 A（诚实 wallet drain deny）与 simulation.test.ts / wallet-declaration.test.ts 重复，
 * 未重复落盘；探针 B/C（诱饵/垃圾 wallet 身份信任缺口）与“对齐假 RPC”下的 V0 诱饵路径为
 * 未修复缺口，未写入本测试，按流程记入 backlog。
 */
import {
  AccountInfo,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { Firewall } from "../src/validate";

interface SimAccount {
  lamports: number;
  owner: string;
  data: string[];
  executable: boolean;
  rentEpoch: number;
}

class FakeConnection {
  postStates: (SimAccount | null)[] = [];
  preStates: (AccountInfo<Buffer> | null)[] = [];
  async simulateTransaction(): Promise<{
    context: unknown;
    value: { err: string | null; accounts: (SimAccount | null)[] | null; logs: string[]; unitsConsumed: number };
  }> {
    return { context: { slot: 1 }, value: { err: null, accounts: this.postStates, logs: [], unitsConsumed: 0 } };
  }
  async getMultipleAccountsInfo(): Promise<(AccountInfo<Buffer> | null)[]> {
    return this.preStates;
  }
  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return { blockhash: "1".repeat(32), lastValidBlockHeight: 100 };
  }
}

function accountInfo(lamports: number, owner: string): AccountInfo<Buffer> {
  return { lamports, owner: new PublicKey(owner), data: Buffer.alloc(0), executable: false, rentEpoch: 0 };
}
function simAccount(lamports: number, owner: string): SimAccount {
  return { lamports, owner, data: [], executable: false, rentEpoch: 0 };
}

const POLICY = {
  amountUnit: "lamports" as const,
  maxTransactionAmount: 100_000,
  confirmationThreshold: 100_000,
  dailyLimit: 10_000_000,
  simulationFeeTolerance: 5_000,
};

describe("wallet 身份信任（探针 E 反转：V0 覆盖完整性 fail-closed）", () => {
  it("V0 + 诱饵 wallet + 响应条数不足（3 键只回 2 条）→ INV_C1(high) → strict deny", async () => {
    const from = Keypair.generate().publicKey;
    const to = Keypair.generate().publicKey;
    const decoy = Keypair.generate().publicKey; // 不在交易中的诱饵钱包

    const msg = new TransactionMessage({
      payerKey: from,
      recentBlockhash: "1".repeat(32),
      instructions: [SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: 500_000 })],
    }).compileToV0Message();
    const vtx = new VersionedTransaction(msg);

    const fake = new FakeConnection();
    // 请求 = 交易 3 个账户键 [from, to, SystemProgram]，假 RPC 只回 2 条
    // → EffectsCollector 分块对账 truncated → fail-closed（修复前无此判定，整体放行）
    fake.postStates = [simAccount(500_000, SystemProgram.programId.toBase58()), simAccount(500_000, SystemProgram.programId.toBase58())];
    fake.preStates = [accountInfo(1_000_000, SystemProgram.programId.toBase58()), accountInfo(0, SystemProgram.programId.toBase58())];

    const r = await new Firewall(POLICY, { connection: fake as unknown as Connection }).validateTransaction({
      action: "transfer",
      amount: 10_000,
      purpose: "test",
      wallet: decoy.toBase58(),
      transaction: vtx,
    });

    const c1 = r.concerns.find((c) => c.id === "INV_C1");
    expect(c1?.severity).toBe("high");
    expect(r.shouldProceed).toBe(false);
    expect(r.requiresConfirmation).toBe(false);
    expect(r.tier).toBe("deny");
    expect(r.fingerprint).not.toBeNull();
    expect(r.decisions.find((d) => d.gate === "invariants")!.verdict).toBe("deny");
  });
});
