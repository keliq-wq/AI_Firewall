/**
 * 验收测试来源：探针 scripts/__auditor2-second-probe.tmp.ts（写于 2026-10-10，早于当日 P1 修复）。
 *
 * 反转（依据 b3e59f8 账本重构：指纹键 + 解析转出额兜底记账）：
 *  - [3] 未声明金额的连续转账现在按解析转出额记账、按交易指纹累积 → allow/block/block/block，store=400
 *  - [3b] 不同幂等键的声明转账累积 → 第 2 笔 DAILY_LIMIT_EXCEEDED deny
 * 保留语义：[2a] 无金额 token transfer → TOKEN_AMOUNT_UNDECLARED(medium) → escalate
 *（该 concern 自首提交即存在，非本日修复；此处按当前 API 固化为回归断言）。
 *
 * 未修复缺口（[1]/[1c] raw 金额不折算、[2b] 小额声明掩护 token 价值、[4] 内存账本重启清零）
 * 未写入本测试，按流程记入 backlog。
 */
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { InMemorySpendStore } from "../src/store";
import { Firewall } from "../src/validate";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** SPL Transfer (type 3)：keys = [source, destination, authority]；amount 为 raw u64 */
function tokenTransferTx(source: PublicKey, dest: PublicKey, authority: PublicKey, rawAmount: bigint): Transaction {
  const data = Buffer.alloc(9);
  data[0] = 3;
  data.writeBigUInt64LE(rawAmount, 1);
  return new Transaction().add({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function nativeTx(from: PublicKey, to: PublicKey, lamports: number): Transaction {
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }));
  tx.feePayer = from;
  tx.recentBlockhash = "1".repeat(32);
  return tx;
}

describe("24h 滚动支出账本（探针 [3]/[3b] 反转）", () => {
  it("[2a] 无金额 token transfer + purpose → TOKEN_AMOUNT_UNDECLARED(medium) escalate", async () => {
    const src = Keypair.generate().publicKey;
    const dst = Keypair.generate().publicKey;
    const auth = Keypair.generate().publicKey;

    const r = await new Firewall({ mode: "strict" }).validateTransaction({
      action: "transfer",
      purpose: "airdrop claim",
      transaction: tokenTransferTx(src, dst, auth, 999_999_999_999_999n),
    });

    const undeclared = r.concerns.find((c) => c.id === "TOKEN_AMOUNT_UNDECLARED");
    expect(undeclared?.severity).toBe("medium");
    expect(r.shouldProceed).toBe(false);
    expect(r.requiresConfirmation).toBe(true);
    expect(r.tier).toBe("notice");
    expect(r.decisions.find((d) => d.gate === "limits")!.verdict).toBe("escalate");
    expect(r.decisions.every((d) => d.verdict !== "deny")).toBe(true);
  });

  it("[3] 未声明金额的 4x400 SOL（交易字节各异）→ 从第 2 笔起累积拦截，store=400", async () => {
    const store = new InMemorySpendStore();
    const fw = new Firewall({
      store,
      maxTransactionAmount: 1000,
      confirmationThreshold: 1000,
      dailyLimit: 500,
    });
    const to = Keypair.generate().publicKey;

    // 第 1 笔：声明缺失 → recordSpend 用解析转出额(400 SOL)兜底记账 → allow
    const r1 = await fw.validateTransaction({
      action: "transfer",
      purpose: "payment",
      transaction: nativeTx(Keypair.generate().publicKey, to, 400 * LAMPORTS_PER_SOL),
    });
    expect(r1.shouldProceed).toBe(true);
    expect(r1.tier).toBe("info");
    expect(r1.fingerprint).not.toBeNull();

    // 第 2 笔：指纹不同（from 各异）→ 支出累积 400+400 > 500 → deny
    const r2 = await fw.validateTransaction({
      action: "transfer",
      purpose: "payment",
      transaction: nativeTx(Keypair.generate().publicKey, to, 400 * LAMPORTS_PER_SOL),
    });
    expect(r2.shouldProceed).toBe(false);
    expect(r2.concerns.some((c) => c.id === "DAILY_LIMIT_EXCEEDED")).toBe(true);
    expect(r2.tier).toBe("deny");
    expect(r2.fingerprint).not.toBe(r1.fingerprint);

    // 第 3、4 笔保持拦截
    const r3 = await fw.validateTransaction({
      action: "transfer",
      purpose: "payment",
      transaction: nativeTx(Keypair.generate().publicKey, to, 400 * LAMPORTS_PER_SOL),
    });
    const r4 = await fw.validateTransaction({
      action: "transfer",
      purpose: "payment",
      transaction: nativeTx(Keypair.generate().publicKey, to, 400 * LAMPORTS_PER_SOL),
    });
    expect([r1.shouldProceed, r2.shouldProceed, r3.shouldProceed, r4.shouldProceed]).toEqual([
      true,
      false,
      false,
      false,
    ]);

    // 只有放行的第 1 笔入库（400）
    expect(await store.sumSince("default", 0)).toBe(400);
  });

  it("[3b] 声明 400+400（不同幂等键）→ 第 2 笔 DAILY_LIMIT_EXCEEDED deny", async () => {
    const store = new InMemorySpendStore();
    const fw = new Firewall({
      store,
      maxTransactionAmount: 1000,
      confirmationThreshold: 1000,
      dailyLimit: 500,
    });

    const a1 = await fw.validateTransaction({
      action: "transfer",
      amount: 400,
      purpose: "p",
      idempotencyKey: "k1",
    });
    const a2 = await fw.validateTransaction({
      action: "transfer",
      amount: 400,
      purpose: "p",
      idempotencyKey: "k2",
    });

    expect(a1.shouldProceed).toBe(true);
    expect(a2.shouldProceed).toBe(false);
    expect(a2.concerns.some((c) => c.id === "DAILY_LIMIT_EXCEEDED")).toBe(true);
    expect(a1.fingerprint).not.toBe(a2.fingerprint);
    expect(await store.sumSince("default", 0)).toBe(400);
  });
});
