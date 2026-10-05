import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { InMemorySpendStore } from "../src/store";
import { Firewall } from "../src/validate";

function transferTx(to: PublicKey, lamports: number): Transaction {
  return new Transaction().add(
    SystemProgram.transfer({ fromPubkey: Keypair.generate().publicKey, toPubkey: to, lamports }),
  );
}

describe("limits 门 — 金额与频率限制", () => {
  it("金额超过单笔上限 → deny（AMOUNT_EXCEEDS_MAX）", async () => {
    const r = await new Firewall().validateTransaction({
      action: "transfer",
      amount: 150,
      purpose: "buy nft",
    });
    expect(r.shouldProceed).toBe(false);
    expect(r.concerns.some((c) => c.id === "AMOUNT_EXCEEDS_MAX")).toBe(true);
  });

  it("金额超过确认阈值但低于上限 → escalate（CONFIRMATION_REQUIRED）", async () => {
    const r = await new Firewall().validateTransaction({
      action: "transfer",
      amount: 50,
      purpose: "buy nft",
    });
    expect(r.requiresConfirmation).toBe(true);
    expect(r.concerns.some((c) => c.id === "CONFIRMATION_REQUIRED")).toBe(true);
  });

  it("意图未声明金额 → 从原生转账推导", async () => {
    const tx = transferTx(Keypair.generate().publicKey, 2 * LAMPORTS_PER_SOL);
    const r = await new Firewall().validateTransaction({
      action: "transfer",
      purpose: "test",
      transaction: tx,
    });
    expect(r.shouldProceed).toBe(true); // 2 SOL < 阈值 10
  });

  it("24h 滚动支出超限 → deny（DAILY_LIMIT_EXCEEDED）", async () => {
    const store = new InMemorySpendStore();
    const fw = new Firewall({
      store,
      maxTransactionAmount: 1000,
      confirmationThreshold: 1000,
      dailyLimit: 500,
    });
    const first = { action: "transfer", amount: 400, purpose: "a", idempotencyKey: "t1" };
    expect((await fw.validateTransaction(first)).shouldProceed).toBe(true);
    const second = await fw.validateTransaction({ ...first, amount: 200, idempotencyKey: "t2" });
    expect(second.shouldProceed).toBe(false);
    expect(second.concerns.some((c) => c.id === "DAILY_LIMIT_EXCEEDED")).toBe(true);
  });

  it("幂等键：同一意图重复校验不重复计入滚动支出", async () => {
    const store = new InMemorySpendStore();
    const fw = new Firewall({ store, maxTransactionAmount: 1000, confirmationThreshold: 1000, dailyLimit: 500 });
    const intent = { action: "transfer", amount: 400, purpose: "a", idempotencyKey: "same" };
    await fw.validateTransaction(intent);
    const again = await fw.validateTransaction(intent);
    expect(again.shouldProceed).toBe(true); // 400 + 0（幂等覆盖）< 500
  });
});
