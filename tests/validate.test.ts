import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { Firewall } from "../src/validate";

describe("validateTransaction 全流程", () => {
  it("敏感操作缺少 purpose → deny（PURPOSE_REQUIRED）", async () => {
    const r = await new Firewall().validateTransaction({
      action: "transfer",
      amount: 1,
      recipient: Keypair.generate().publicKey.toBase58(),
    });
    expect(r.shouldProceed).toBe(false);
    expect(r.concerns.some((c) => c.id === "PURPOSE_REQUIRED")).toBe(true);
  });

  it("owner 变更即使 requirePurposeFor 为空仍强制要求 purpose（硬基线）", async () => {
    const tx = new Transaction().add(
      SystemProgram.assign({
        accountPubkey: Keypair.generate().publicKey,
        programId: Keypair.generate().publicKey,
      }),
    );
    const fw = new Firewall({ requirePurposeFor: [], mode: "monitor" });
    const r = await fw.validateTransaction({ action: "custom", transaction: tx });
    expect(r.concerns.some((c) => c.id === "PURPOSE_REQUIRED")).toBe(true);
  });

  it("黑名单地址 → critical deny（无视 mode）", async () => {
    const bad = Keypair.generate().publicKey.toBase58();
    const fw = new Firewall({ mode: "monitor", blockedAddresses: [bad] });
    const r = await fw.validateTransaction({
      action: "transfer",
      amount: 1,
      recipient: bad,
      purpose: "x",
    });
    expect(r.shouldProceed).toBe(false);
    expect(r.requiresConfirmation).toBe(false);
    expect(r.concerns.some((c) => c.id === "BLOCKED_ADDRESS")).toBe(true);
  });

  it("良性交易：四门全过 → shouldProceed，summary 可读", async () => {
    const fw = new Firewall({ maxTransactionAmount: 1000, confirmationThreshold: 1000 });
    const r = await fw.validateTransaction({
      action: "transfer",
      amount: 5,
      purpose: "Payment for NFT purchase",
      recipient: Keypair.generate().publicKey.toBase58(),
      idempotencyKey: "benign-1",
      wallet: Keypair.generate().publicKey.toBase58(),
    });
    expect(r.shouldProceed).toBe(true);
    expect(r.requiresConfirmation).toBe(false);
    expect(r.decisions.map((d) => d.verdict)).toEqual(["allow", "allow", "allow", "allow", "allow"]);
    expect(r.decisions.map((d) => d.gate)).toEqual(["credibility", "limits", "envelope", "avoidance", "worth"]);
    expect(r.summary).toContain("passed");
  });

  it("monitor 模式：高危违规整体降级为人工确认", async () => {
    const fw = new Firewall({ mode: "monitor" });
    const r = await fw.validateTransaction({ action: "swap", amount: 200 });
    // 金额超限 + 缺少 purpose，均为 high → monitor 下 escalate 而非 deny
    expect(r.shouldProceed).toBe(false);
    expect(r.requiresConfirmation).toBe(true);
    expect(r.decisions.every((d) => d.verdict !== "deny")).toBe(true);
  });
});
