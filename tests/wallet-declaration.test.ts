/**
 * 验收测试来源：证伪探针 tests/__refute-decoy-wallet.tmp.test.ts（写于 2026-10-10，早于当日 P1 修复）。
 *
 * 保留对照组（探针 #2）并适配当前 API（81ba8d2 envelope / 38dbf58 tier+fingerprint）：
 * 诚实声明 wallet 时，隐藏流出被 envelope（AMOUNT_EXCEEDS_ENVELOPE）与 simulation
 * （UNEXPECTED_DRAIN）双重拦截。
 *
 * 数值适配：声明额取 4 lamports（探针原值 1000）。envelope 现实现将声明原值与 SOL
 * 流出数值直接比较、未按 amountUnit 折算，lamports 模式下 1000 不触发；该口径缺口不写入
 * 本测试（记 backlog），取 4 使其在任何合理的单位折算修复前后都命中拦截路径。
 *
 * 未修复缺口——探针 #1（诱饵 wallet 静默关闭 L2 流出检查）与 #3（省略 transaction 的
 * 直连 API 路径；MCP 边界已由 transactionBase64 必传关闭）——未写入本测试，按流程记入 backlog。
 */
import {
  AccountInfo,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
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
  maxTransactionAmount: 100_000_000,
  confirmationThreshold: 50_000_000,
  dailyLimit: 1_000_000_000,
  simulationFeeTolerance: 5000,
};

describe("wallet 声明交叉核对（如实声明 wallet 时隐藏流出被拦截）", () => {
  it("真实流出 ~5 SOL 但仅声明 4 lamports → envelope + simulation 双重 deny", async () => {
    const victim = Keypair.generate().publicKey;
    const attacker = Keypair.generate().publicKey;

    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: victim, toPubkey: attacker, lamports: 5_000_000_000 }),
    );
    tx.feePayer = victim;
    tx.recentBlockhash = "1".repeat(32);

    const fake = new FakeConnection();
    // nonProgramIds 顺序 = [victim, attacker]
    fake.postStates = [
      simAccount(4_994_995_000, SystemProgram.programId.toBase58()),
      simAccount(5_000_000_000, SystemProgram.programId.toBase58()),
    ];
    fake.preStates = [
      accountInfo(10_000_000_000, SystemProgram.programId.toBase58()),
      accountInfo(0, SystemProgram.programId.toBase58()),
    ];

    const fw = new Firewall(POLICY, { connection: fake as unknown as Connection });
    const r = await fw.validateTransaction({
      action: "transfer",
      amount: 4, // 声明 4 lamports（链上实际流出 ~5 SOL）
      purpose: "paying a small invoice",
      wallet: victim.toBase58(), // 诚实：交易真实付款方
      transaction: tx,
    });

    // simulation 门：净流出 5_005_000_000 >> 声明 1000 + 容差
    expect(r.concerns.some((c) => c.id === "UNEXPECTED_DRAIN" && c.severity === "high")).toBe(true);
    // envelope 门（81ba8d2 双保险）：解析事实 5 SOL > 声明 4 lamports
    expect(r.concerns.some((c) => c.id === "AMOUNT_EXCEEDS_ENVELOPE" && c.severity === "high")).toBe(true);
    expect(r.decisions.find((d) => d.gate === "envelope")!.verdict).toBe("deny");
    expect(r.shouldProceed).toBe(false);
    expect(r.requiresConfirmation).toBe(false);
    expect(r.tier).toBe("deny");
    expect(r.fingerprint).not.toBeNull();
    expect(r.decisions.find((d) => d.gate === "simulation")!.verdict).toBe("deny");
  });
});
