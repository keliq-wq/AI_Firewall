import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { Firewall } from "../src/validate";

const WALLET = Keypair.generate();

function assignTx(targetOwner: PublicKey): Transaction {
  return new Transaction().add(
    SystemProgram.assign({ accountPubkey: WALLET.publicKey, programId: targetOwner }),
  );
}

describe("credibility 门 — owner 变更检测（核心差异化能力）", () => {
  it("owner 变更为未验证程序 → strict 下 deny（OWNER_CHANGE）", async () => {
    const fw = new Firewall();
    const r = await fw.validateTransaction({
      action: "assign_owner",
      purpose: "test",
      transaction: assignTx(Keypair.generate().publicKey),
    });
    expect(r.shouldProceed).toBe(false);
    const concern = r.concerns.find((c) => c.id === "OWNER_CHANGE");
    expect(concern).toBeDefined();
    expect(concern!.severity).toBe("high");
    expect(r.decisions.find((d) => d.gate === "credibility")!.verdict).toBe("deny");
  });

  it("monitor 模式下 owner 变更降级为 escalate（需人工确认）", async () => {
    const fw = new Firewall({ mode: "monitor" });
    const r = await fw.validateTransaction({
      action: "assign_owner",
      purpose: "test",
      transaction: assignTx(Keypair.generate().publicKey),
    });
    expect(r.shouldProceed).toBe(false);
    expect(r.requiresConfirmation).toBe(true);
    expect(r.concerns.every((c) => c.severity !== "critical")).toBe(true);
  });

  it("owner 变更为白名单程序 → escalate 需人工确认", async () => {
    const allowed = Keypair.generate().publicKey;
    // assign 指令本身调用 SystemProgram，白名单需同时包含它
    const fw = new Firewall({
      allowedPrograms: [SystemProgram.programId.toBase58(), allowed.toBase58()],
    });
    const r = await fw.validateTransaction({
      action: "assign_owner",
      purpose: "test",
      transaction: assignTx(allowed),
    });
    expect(r.requiresConfirmation).toBe(true);
    expect(r.concerns.some((c) => c.id === "OWNER_CHANGE_WHITELISTED")).toBe(true);
  });

  it("owner 变更为黑名单程序 → critical deny（无视 mode）", async () => {
    const bad = Keypair.generate().publicKey;
    const fw = new Firewall({ mode: "monitor", blockedPrograms: [bad.toBase58()] });
    const r = await fw.validateTransaction({
      action: "assign_owner",
      purpose: "test",
      transaction: assignTx(bad),
    });
    expect(r.shouldProceed).toBe(false);
    expect(r.requiresConfirmation).toBe(false);
    expect(r.concerns.some((c) => c.id === "OWNER_CHANGE_BLOCKED")).toBe(true);
  });

  it("createAccount(含非系统 owner)为正常建户,不再误报为 owner 变更", async () => {
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: WALLET.publicKey,
        newAccountPubkey: Keypair.generate().publicKey,
        lamports: 1_000_000,
        space: 0,
        programId: Keypair.generate().publicKey, // 非系统程序的 owner
      }),
    );
    const r = await new Firewall().validateTransaction({
      action: "create_account",
      purpose: "test",
      transaction: tx,
    });
    expect(r.concerns.some((c) => c.id === "ACCOUNT_CREATED")).toBe(true);
    expect(r.concerns.some((c) => c.id === "OWNER_CHANGE")).toBe(false);
    expect(r.shouldProceed).toBe(true);
  });

  it("白名单外的程序调用 → PROGRAM_NOT_ALLOWED", async () => {
    // 注意：owner 变更目标程序不是"被调用的程序"，不走白名单（走 OWNER_CHANGE 规则）；
    // 这里构造一笔直接调用未验证程序的交易来覆盖白名单检查
    const tx = new Transaction().add(
      new TransactionInstruction({
        keys: [],
        programId: Keypair.generate().publicKey,
        data: Buffer.alloc(0),
      }),
    );
    const fw = new Firewall({ allowedPrograms: [SystemProgram.programId.toBase58()] });
    const r = await fw.validateTransaction({ action: "custom", purpose: "test", transaction: tx });
    expect(r.concerns.some((c) => c.id === "PROGRAM_NOT_ALLOWED")).toBe(true);
  });
});
