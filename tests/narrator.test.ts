import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { Firewall } from "../src/validate";

describe("风险叙述器（可解释安全）", () => {
  it("拦截决策 → 中文叙述包含『已拦截』与风险详情", async () => {
    const fw = new Firewall();
    const intent = { action: "transfer", amount: 50, recipient: "9WzDX...", idempotencyKey: "n1" };
    const result = await fw.validateTransaction(intent);
    const text = await fw.explain(intent, result);
    expect(text).toContain("已拦截");
    expect(text).toContain("操作：transfer");
    expect(text).toContain("9WzDX...");
    expect(text).toContain("高风险"); // 高风险项被写入叙述
    expect(text).toContain("business purpose");
  });

  it("放行决策 → 中文叙述包含『已放行』", async () => {
    const fw = new Firewall({ maxTransactionAmount: 1000, confirmationThreshold: 1000 });
    const intent = {
      action: "transfer",
      amount: 5,
      purpose: "Payment for NFT purchase",
      idempotencyKey: "n2",
      wallet: Keypair.generate().publicKey.toBase58(),
    };
    const result = await fw.validateTransaction(intent);
    const text = await fw.explain(intent, result);
    expect(text).toContain("已放行");
    expect(text).toContain("业务理由：Payment for NFT purchase");
  });
});
