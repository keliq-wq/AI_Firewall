/**
 * 验收测试来源：探针 scripts/__refuter-fresh-limits-probe.tmp.ts 与
 * scripts/__refuter-mcp-claims-probe.tmp.ts（写于 2026-10-10，早于当日 P1 修复）。
 *
 * 反转（依据 b3e59f8 指纹键记账）：
 *  - A2：同收款方、同金额、无幂等键，但交易字节每次不同 → 指纹不同 → 第 2 笔起 DAILY_LIMIT_EXCEEDED
 *  - mcp-claims B：不同收款方正常累积 → 第 3 笔（200×3 > 500）deny
 *  - C：不同幂等键同收款方 → 第 2 笔 deny
 * 保留语义 D（预期幂等）：同一幂等键重试 → 两笔均放行、只记一次。
 *
 * 未修复缺口（A：无交易时同参数自述塌缩为同一指纹，仅直接 API 可达）未写入本测试，
 * 按流程记入 backlog。
 */
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { InMemorySpendStore } from "../src/store";
import { Firewall } from "../src/validate";

/** 交易字节每次不同的原生转账（from 按轮次随机） */
function nativeTx(from: PublicKey, to: PublicKey, lamports: number): Transaction {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }));
  tx.feePayer = from;
  tx.recentBlockhash = "1".repeat(32);
  return tx;
}

describe("支出键 = 交易内容指纹（探针 A2/B/C 反转）", () => {
  it("A2：同收款方同金额、无幂等键、交易各异 → 第 2 笔起 DAILY_LIMIT_EXCEEDED", async () => {
    const store = new InMemorySpendStore();
    const fw = new Firewall({
      store,
      maxTransactionAmount: 4.5,
      confirmationThreshold: 10,
      dailyLimit: 5,
    });
    const recipient = Keypair.generate().publicKey;

    const results: { shouldProceed: boolean; concerns: string[] }[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await fw.validateTransaction({
        action: "transfer",
        amount: 4,
        purpose: `p-${i}`,
        transaction: nativeTx(Keypair.generate().publicKey, recipient, 4 * LAMPORTS_PER_SOL),
      });
      results.push({ shouldProceed: r.shouldProceed, concerns: r.concerns.map((c) => c.id) });
    }

    expect(results.map((r) => r.shouldProceed)).toEqual([true, false, false]);
    expect(results[1]!.concerns).toContain("DAILY_LIMIT_EXCEEDED");
    // 修复前断言：5 次同参数全部按“重试替换”放行——现按交易指纹累积
    expect(await store.sumSince("default", 0)).toBe(4);
  });

  it("B：不同收款方累积（4x200，日限 500）→ 第 3 笔起 deny", async () => {
    const fw = new Firewall({ maxTransactionAmount: 1000, confirmationThreshold: 1000, dailyLimit: 500 });

    const results: { shouldProceed: boolean; tier: string; concerns: string[] }[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await fw.validateTransaction({
        action: "transfer",
        amount: 200,
        recipient: Keypair.generate().publicKey.toBase58(),
        purpose: "recurring payment",
      });
      results.push({
        shouldProceed: r.shouldProceed,
        tier: r.tier,
        concerns: r.concerns.map((c) => c.id),
      });
    }

    // 修复前结论“同收款方 key 覆盖”对交易路径不再成立：异笔累积，第 3 笔 600 > 500 拦截
    expect(results.map((r) => r.shouldProceed)).toEqual([true, true, false, false]);
    expect(results.map((r) => r.tier)).toEqual(["info", "info", "deny", "deny"]);
    expect(results[2]!.concerns).toContain("DAILY_LIMIT_EXCEEDED");
    expect(results[3]!.concerns).toContain("DAILY_LIMIT_EXCEEDED");
  });

  it("C：不同幂等键同收款方 → 第 2 笔 DAILY_LIMIT_EXCEEDED deny", async () => {
    const store = new InMemorySpendStore();
    const fw = new Firewall({
      store,
      maxTransactionAmount: 4.5,
      confirmationThreshold: 10,
      dailyLimit: 5,
    });
    const recipient = Keypair.generate().publicKey.toBase58();

    const c1 = await fw.validateTransaction({
      action: "transfer",
      amount: 4,
      recipient,
      purpose: "p1",
      idempotencyKey: "k1",
    });
    const c2 = await fw.validateTransaction({
      action: "transfer",
      amount: 4,
      recipient,
      purpose: "p2",
      idempotencyKey: "k2",
    });

    expect(c1.shouldProceed).toBe(true);
    expect(c2.shouldProceed).toBe(false);
    expect(c2.concerns.some((c) => c.id === "DAILY_LIMIT_EXCEEDED")).toBe(true);
    expect(c1.fingerprint).not.toBe(c2.fingerprint);
  });

  it("D：同一幂等键重试 → 两笔均放行、只记一次", async () => {
    const store = new InMemorySpendStore();
    const fw = new Firewall({
      store,
      maxTransactionAmount: 4.5,
      confirmationThreshold: 10,
      dailyLimit: 5,
    });
    const intent = {
      action: "transfer",
      amount: 4,
      recipient: Keypair.generate().publicKey.toBase58(),
      purpose: "retry",
      idempotencyKey: "same",
    };

    const d1 = await fw.validateTransaction(intent);
    const d2 = await fw.validateTransaction(intent); // 重试同一意图

    expect(d1.shouldProceed).toBe(true);
    expect(d2.shouldProceed).toBe(true);
    expect(d1.fingerprint).toBe(d2.fingerprint); // 同一意图 → 同一指纹
    expect(await store.sumSince("default", 0)).toBe(4); // 计数一次
  });
});
