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

/** 模拟 RPC：simulateTransaction / getMultipleAccountsInfo / getLatestBlockhash */
interface SimAccount {
  lamports: number;
  owner: string;
  data: string[];
  executable: boolean;
  rentEpoch: number;
}

class FakeConnection {
  simErr: string | null = null;
  postStates: (SimAccount | null)[] = [];
  preStates: (AccountInfo<Buffer> | null)[] = [];

  async simulateTransaction(): Promise<{
    context: unknown;
    value: {
      err: string | null;
      accounts: (SimAccount | null)[] | null;
      logs: string[];
      unitsConsumed: number;
    };
  }> {
    return {
      context: { slot: 1 },
      value: { err: this.simErr, accounts: this.postStates, logs: [], unitsConsumed: 0 },
    };
  }
  async getMultipleAccountsInfo(): Promise<(AccountInfo<Buffer> | null)[]> {
    return this.preStates;
  }
  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return { blockhash: "7".repeat(64), lastValidBlockHeight: 100 };
  }
}

function transferTx(from: PublicKey, to: PublicKey, lamports: number): Transaction {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }),
  );
  tx.feePayer = from; // 真实场景中交易由 Agent 钱包签名付费
  return tx;
}

function accountInfo(lamports: number, owner: string): AccountInfo<Buffer> {
  return {
    lamports,
    owner: new PublicKey(owner),
    data: Buffer.alloc(0),
    executable: false,
    rentEpoch: 0,
  };
}

function simAccount(lamports: number, owner: string): SimAccount {
  return { lamports, owner, data: [], executable: false, rentEpoch: 0 };
}

/**
 * 模拟响应对齐说明：legacy 交易模拟返回 nonProgramIds 顺序的账户状态，
 * 即 [from, to]（不含 SystemProgram），因此 post/pre 数组均为两项。
 */
function transferStates(fromPost: number, toPost: number, fromPre = 1_000_000, toPre = 0, toOwner = SystemProgram.programId.toBase58()) {
  return {
    postStates: [
      simAccount(fromPost, SystemProgram.programId.toBase58()),
      simAccount(toPost, toOwner),
    ],
    preStates: [
      accountInfo(fromPre, SystemProgram.programId.toBase58()),
      accountInfo(toPre, SystemProgram.programId.toBase58()),
    ],
  };
}

const LOOSE_POLICY = {
  amountUnit: "lamports" as const,
  maxTransactionAmount: 1_000_000,
  confirmationThreshold: 1_000_000,
  dailyLimit: 100_000_000,
  simulationFeeTolerance: 5000,
};

function firewallWith(fake: FakeConnection): Firewall {
  return new Firewall(LOOSE_POLICY, { connection: fake as unknown as Connection });
}

describe("simulation 门（第 2 层：模拟执行验证）", () => {
  it("模拟失败（将 revert）→ SIMULATION_ERROR escalate", async () => {
    const from = Keypair.generate().publicKey;
    const to = Keypair.generate().publicKey;
    const fake = new FakeConnection();
    fake.simErr = "ProgramFailedToComplete";
    Object.assign(fake, transferStates(990_000, 10_000));

    const r = await firewallWith(fake).validateTransaction({
      action: "transfer",
      amount: 10000,
      purpose: "test",
      wallet: from.toBase58(),
      transaction: transferTx(from, to, 10000),
    });
    expect(r.requiresConfirmation).toBe(true);
    expect(r.concerns.some((c) => c.id === "SIMULATION_ERROR")).toBe(true);
  });

  it("CPI 层 owner 变更（第 1 层看不见）→ critical deny", async () => {
    const from = Keypair.generate().publicKey;
    const to = Keypair.generate().publicKey;
    const attacker = Keypair.generate().publicKey;
    const fake = new FakeConnection();
    // 顶层指令只是普通转账（第 1 层不会标记），但模拟揭示 to 账户 owner 被 CPI 篡改
    Object.assign(fake, transferStates(999_000, 1_000, 1_000_000, 0, attacker.toBase58()));

    const r = await firewallWith(fake).validateTransaction({
      action: "transfer",
      amount: 1000,
      purpose: "test",
      wallet: from.toBase58(),
      transaction: transferTx(from, to, 1000),
    });
    expect(r.shouldProceed).toBe(false);
    expect(r.requiresConfirmation).toBe(false);
    expect(r.concerns.some((c) => c.id === "OWNER_CHANGE_SIMULATED")).toBe(true);
  });

  it("净流出与声明金额一致 → 放行", async () => {
    const from = Keypair.generate().publicKey;
    const to = Keypair.generate().publicKey;
    const fake = new FakeConnection();
    Object.assign(fake, transferStates(990_000, 10_000));

    const r = await firewallWith(fake).validateTransaction({
      action: "transfer",
      amount: 10000,
      purpose: "test",
      wallet: from.toBase58(),
      transaction: transferTx(from, to, 10000),
    });
    expect(r.shouldProceed).toBe(true);
    expect(r.decisions.find((d) => d.gate === "simulation")!.verdict).toBe("allow");
  });

  it("净流出超出声明金额 + 容差 → UNEXPECTED_DRAIN deny", async () => {
    const from = Keypair.generate().publicKey;
    const to = Keypair.generate().publicKey;
    const fake = new FakeConnection();
    // 声明 10_000，实际流出 30_000（> 10_000 + 5_000 容差）
    Object.assign(fake, transferStates(970_000, 30_000));

    const r = await firewallWith(fake).validateTransaction({
      action: "transfer",
      amount: 10000,
      purpose: "test",
      wallet: from.toBase58(),
      transaction: transferTx(from, to, 10000),
    });
    expect(r.shouldProceed).toBe(false);
    expect(r.concerns.some((c) => c.id === "UNEXPECTED_DRAIN")).toBe(true);
  });

  it("未声明金额却有净流出 → UNDECLARED_OUTFLOW deny", async () => {
    const from = Keypair.generate().publicKey;
    const to = Keypair.generate().publicKey;
    const fake = new FakeConnection();
    Object.assign(fake, transferStates(980_000, 20_000));

    const r = await firewallWith(fake).validateTransaction({
      action: "transfer",
      purpose: "test",
      wallet: from.toBase58(),
      transaction: transferTx(from, to, 20000),
    });
    expect(r.shouldProceed).toBe(false);
    expect(r.concerns.some((c) => c.id === "UNDECLARED_OUTFLOW")).toBe(true);
  });

  it("仅手续费流出（容差内）→ 放行", async () => {
    const from = Keypair.generate().publicKey;
    const to = Keypair.generate().publicKey;
    const fake = new FakeConnection();
    // 0 lamports 转账，仅 5000 手续费（<= 容差）
    Object.assign(fake, transferStates(995_000, 0));

    const r = await firewallWith(fake).validateTransaction({
      action: "transfer",
      purpose: "test",
      wallet: from.toBase58(),
      transaction: transferTx(from, to, 0),
    });
    expect(r.shouldProceed).toBe(true);
  });

  it("未声明 wallet → 仅提示（WALLET_UNDECLARED，不拦截）", async () => {
    const from = Keypair.generate().publicKey;
    const to = Keypair.generate().publicKey;
    const fake = new FakeConnection();
    Object.assign(fake, transferStates(990_000, 10_000));

    const r = await firewallWith(fake).validateTransaction({
      action: "transfer",
      amount: 10000,
      purpose: "test",
      transaction: transferTx(from, to, 10000),
    });
    expect(r.shouldProceed).toBe(true);
    expect(r.concerns.some((c) => c.id === "WALLET_UNDECLARED")).toBe(true);
  });
});
