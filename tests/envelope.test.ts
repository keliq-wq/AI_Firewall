import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { Firewall } from "../src";

const WALLET = Keypair.generate();
const RECIPIENT = Keypair.generate().publicKey;

function transferTx(from: PublicKey, to: PublicKey, lamports: number): Transaction {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }));
  tx.feePayer = from;
  tx.recentBlockhash = "1".repeat(32);
  return tx;
}

describe("envelope 门 — 声明只作上限,解析事实交叉核对", () => {
  it("旗舰场景:声明 0.002 实转 0.04 → deny(AMOUNT_EXCEEDS_ENVELOPE)", async () => {
    const fw = new Firewall();
    const r = await fw.validateTransaction({
      action: "transfer",
      amount: 0.002,
      recipient: RECIPIENT.toBase58(),
      purpose: "Pay for compute",
      wallet: WALLET.publicKey.toBase58(),
      transaction: transferTx(WALLET.publicKey, RECIPIENT, 0.04 * LAMPORTS_PER_SOL),
    });
    expect(r.shouldProceed).toBe(false);
    expect(r.concerns.some((c) => c.id === "AMOUNT_EXCEEDS_ENVELOPE")).toBe(true);
  });

  it("诚实声明(声明==实际)→ 放行", async () => {
    const fw = new Firewall();
    const r = await fw.validateTransaction({
      action: "transfer",
      amount: 0.04,
      recipient: RECIPIENT.toBase58(),
      purpose: "Pay for compute",
      wallet: WALLET.publicKey.toBase58(),
      transaction: transferTx(WALLET.publicKey, RECIPIENT, 0.04 * LAMPORTS_PER_SOL),
    });
    expect(r.shouldProceed).toBe(true);
    expect(r.concerns.some((c) => c.id === "AMOUNT_EXCEEDS_ENVELOPE")).toBe(false);
  });

  it("有转出但无声明 → deny(UNDECLARED_OUTFLOW)", async () => {
    const fw = new Firewall();
    const r = await fw.validateTransaction({
      action: "transfer",
      purpose: "Pay for compute",
      wallet: WALLET.publicKey.toBase58(),
      transaction: transferTx(WALLET.publicKey, RECIPIENT, 0.02 * LAMPORTS_PER_SOL),
    });
    expect(r.shouldProceed).toBe(false);
    expect(r.concerns.some((c) => c.id === "UNDECLARED_OUTFLOW")).toBe(true);
  });

  it("收款方与声明不符 → medium concern(叙述层,不 deny)", async () => {
    const fw = new Firewall();
    const other = Keypair.generate().publicKey;
    const r = await fw.validateTransaction({
      action: "transfer",
      amount: 0.01,
      recipient: "9WzDXwQnLfL3vZ5xR2tM8pYcH1sK7jN4bG6fD3eA2qU", // 与实际不符
      purpose: "Pay for compute",
      wallet: WALLET.publicKey.toBase58(),
      transaction: transferTx(WALLET.publicKey, other, 0.01 * LAMPORTS_PER_SOL),
    });
    expect(r.concerns.some((c) => c.id === "RECIPIENT_MISMATCH" && c.severity === "medium")).toBe(true);
  });

  it("不声明 wallet → 从 fee payer 推导,核对照常生效(封死诱饵绕过)", async () => {
    const fw = new Firewall();
    // 未声明 wallet:声明 0.002 实转 0.04 → 照样拦截
    const r = await fw.validateTransaction({
      action: "transfer",
      amount: 0.002,
      recipient: RECIPIENT.toBase58(),
      purpose: "Pay for compute",
      transaction: transferTx(WALLET.publicKey, RECIPIENT, 0.04 * LAMPORTS_PER_SOL),
    });
    expect(r.shouldProceed).toBe(false);
    expect(r.concerns.some((c) => c.id === "AMOUNT_EXCEEDS_ENVELOPE")).toBe(true);
  });

  it("声明 wallet 与 fee payer 不符 → WALLET_MISMATCH concern", async () => {
    const fw = new Firewall();
    const decoy = Keypair.generate().publicKey;
    const r = await fw.validateTransaction({
      action: "transfer",
      amount: 0.01,
      recipient: RECIPIENT.toBase58(),
      purpose: "Pay for compute",
      wallet: decoy.toBase58(), // 诱饵
      transaction: transferTx(WALLET.publicKey, RECIPIENT, 0.01 * LAMPORTS_PER_SOL),
    });
    expect(r.concerns.some((c) => c.id === "WALLET_MISMATCH")).toBe(true);
  });
});
