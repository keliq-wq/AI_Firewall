import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { Firewall } from "../src";

const WALLET = Keypair.generate();
const RECIPIENT = Keypair.generate().publicKey;

function transferTx(lamports: number): Transaction {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: WALLET.publicKey, toPubkey: RECIPIENT, lamports }));
  tx.feePayer = WALLET.publicKey;
  tx.recentBlockhash = "1".repeat(32);
  return tx;
}

function transferTxFrom(from: PublicKey, lamports: number): Transaction {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: RECIPIENT, lamports }));
  tx.feePayer = from;
  tx.recentBlockhash = "1".repeat(32);
  return tx;
}

describe("升级分级(tier)与指纹", () => {
  it("旗舰场景 deny → tier=deny 且指纹非空", async () => {
    const fw = new Firewall();
    const r = await fw.validateTransaction({
      action: "transfer",
      amount: 0.002,
      recipient: RECIPIENT.toBase58(),
      purpose: "Pay",
      wallet: WALLET.publicKey.toBase58(),
      transaction: transferTx(0.04 * LAMPORTS_PER_SOL),
    });
    expect(r.shouldProceed).toBe(false);
    expect(r.tier).toBe("deny");
    expect(r.fingerprint).not.toBeNull();
  });

  it("纯意图无交易无钱包 → 升级人工确认(tier=notice)且指纹为空", async () => {
    const fw = new Firewall({ maxTransactionAmount: 1000, confirmationThreshold: 1000 });
    const r = await fw.validateTransaction({ action: "transfer", amount: 1, purpose: "Pay" });
    expect(r.shouldProceed).toBe(false);
    expect(r.requiresConfirmation).toBe(true);
    expect(r.tier).toBe("notice"); // WALLET_UNDECLARED medium——无交易无钱包不再静默放行
    expect(r.fingerprint).toBeNull();
  });

  it("monitor 模式高危 → tier=confirm + requiresConfirmation", async () => {
    const fw = new Firewall({ mode: "monitor" });
    const r = await fw.validateTransaction({
      action: "custom",
      purpose: "test",
      transaction: new Transaction().add(
        SystemProgram.assign({ accountPubkey: WALLET.publicKey, programId: Keypair.generate().publicKey }),
      ),
    });
    expect(r.shouldProceed).toBe(false);
    expect(r.requiresConfirmation).toBe(true);
    expect(r.tier).toBe("confirm");
  });

  it("同交易两次校验 → 指纹一致", async () => {
    const fw = new Firewall({ maxTransactionAmount: 10, dailyLimit: 10 });
    const intent = {
      action: "transfer",
      amount: 1,
      recipient: RECIPIENT.toBase58(),
      purpose: "Pay",
      wallet: WALLET.publicKey.toBase58(),
      transaction: transferTx(1 * LAMPORTS_PER_SOL),
    };
    const r1 = await fw.validateTransaction(intent);
    const r2 = await fw.validateTransaction(intent);
    expect(r1.fingerprint).toBe(r2.fingerprint);
  });

  it("升级占比统计(stats)累进", async () => {
    const fw = new Firewall({ maxTransactionAmount: 2000, confirmationThreshold: 1000, dailyLimit: 5000 });
    const w1 = Keypair.generate();
    const w2 = Keypair.generate();
    await fw.validateTransaction({
      action: "transfer",
      amount: 1,
      recipient: RECIPIENT.toBase58(),
      purpose: "a",
      wallet: w1.publicKey.toBase58(),
      transaction: transferTxFrom(w1.publicKey, 1 * LAMPORTS_PER_SOL),
    }); // allow → info
    await fw.validateTransaction({
      action: "transfer",
      amount: 1500,
      recipient: RECIPIENT.toBase58(),
      purpose: "b",
      wallet: w2.publicKey.toBase58(),
      transaction: transferTxFrom(w2.publicKey, 1500 * LAMPORTS_PER_SOL),
    }); // >确认阈值 → notice
    const s = fw.stats;
    expect(s.validations).toBe(2);
    expect(s.tiers.info).toBe(1);
    expect(s.tiers.notice).toBe(1);
  });
});
