import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { AppendOnlySpendStore, transactionFingerprint } from "../src/accounting";
import { Firewall } from "../src";

const WALLET = Keypair.generate();
const RECIPIENT = Keypair.generate().publicKey;

function transferTx(to: Parameters<typeof Keypair.generate>[0] extends never ? never : Keypair["publicKey"], lamports: number): Transaction {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: WALLET.publicKey, toPubkey: to, lamports }));
  tx.feePayer = WALLET.publicKey;
  tx.recentBlockhash = "1".repeat(32);
  return tx;
}

describe("账本 — 三路绕过修复", () => {
  it("绕过 1:未声明金额的转出不再静默放行——信封门从 fee payer 推导钱包并拒绝", async () => {
    const store = new AppendOnlySpendStore();
    const fw = new Firewall({ maxTransactionAmount: 10, dailyLimit: 10, store });
    const r = await fw.validateTransaction({
      action: "transfer",
      // 不声明 amount、不声明 wallet → fee payer 推导出钱包 → UNDECLARED_OUTFLOW 拒绝
      purpose: "Pay",
      transaction: transferTx(RECIPIENT, 1 * LAMPORTS_PER_SOL),
    });
    expect(r.shouldProceed).toBe(false);
    expect(r.concerns.some((c) => c.id === "UNDECLARED_OUTFLOW")).toBe(true);
  });

  it("绕过 2:同收款方不同交易累积(不再 key 覆盖)", async () => {
    const store = new AppendOnlySpendStore();
    const fw = new Firewall({ maxTransactionAmount: 10, dailyLimit: 1.5, store });
    const amounts = [0.4, 0.6]; // 交易内容不同 → 指纹不同
    for (const amount of amounts) {
      await fw.validateTransaction({
        action: "transfer",
        amount,
        recipient: RECIPIENT.toBase58(), // 同一收款方!
        purpose: "Pay",
        wallet: WALLET.publicKey.toBase58(),
        transaction: transferTx(RECIPIENT, amount * LAMPORTS_PER_SOL),
      });
    }
    const spent = store.sumSince("default", 0);
    expect(spent).toBe(1); // 0.4 + 0.6 都记账,不再被覆盖
  });

  it("幂等:同一交易重复校验不重复记账", async () => {
    const store = new AppendOnlySpendStore();
    const fw = new Firewall({ maxTransactionAmount: 10, dailyLimit: 10, store });
    const intent = {
      action: "transfer",
      amount: 1,
      recipient: RECIPIENT.toBase58(),
      purpose: "Pay",
      wallet: WALLET.publicKey.toBase58(),
      transaction: transferTx(RECIPIENT, 1 * LAMPORTS_PER_SOL),
    };
    await fw.validateTransaction(intent);
    await fw.validateTransaction(intent); // 重试同一笔
    const spent = store.sumSince("default", 0);
    expect(spent).toBe(1); // 指纹相同 → 替换而非累加
  });

  it("绕过 3:缺 recipient 的塌缩 key 不再影响累积", async () => {
    const store = new AppendOnlySpendStore();
    const fw = new Firewall({ maxTransactionAmount: 10, dailyLimit: 10, store });
    for (let i = 0; i < 2; i++) {
      const to = Keypair.generate().publicKey;
      await fw.validateTransaction({
        action: "transfer",
        amount: 0.5,
        // 无 recipient
        purpose: "Pay",
        wallet: WALLET.publicKey.toBase58(),
        transaction: transferTx(to, 0.5 * LAMPORTS_PER_SOL),
      });
    }
    const spent = store.sumSince("default", 0);
    expect(spent).toBe(1); // 两笔 0.5 都记账
  });

  it("交易内容变化 → 指纹变化", () => {
    const t1 = transferTx(RECIPIENT, 1 * LAMPORTS_PER_SOL);
    const t2 = transferTx(Keypair.generate().publicKey, 1 * LAMPORTS_PER_SOL);
    const i1 = { action: "transfer", amount: 1, transaction: t1 };
    const i2 = { action: "transfer", amount: 1, transaction: t2 };
    const f1 = transactionFingerprint(i1 as never, { nativeTransfers: [] } as never);
    const f2 = transactionFingerprint(i2 as never, { nativeTransfers: [] } as never);
    expect(f1).not.toBe(f2);
    // 同一交易两次 → 同指纹
    expect(transactionFingerprint(i1 as never, { nativeTransfers: [] } as never)).toBe(f1);
  });
});
