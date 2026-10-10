import { Keypair, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { isVersionedTransaction } from "../src/parser";
import { accountKeysOf } from "../src/rpc/simulator";

/**
 * 双包场景回归:消费者工程自带一份 @solana/web3.js 时,`instanceof` 跨副本
 * 失效,legacy 交易会误入 versioned 分支(读 undefined message)崩溃。
 * 判别改用结构化判断(message.getAccountKeys 存在性),这里直接验证行为。
 */
describe("交易类型结构化判别(跨 web3.js 副本安全)", () => {
  it("legacy Transaction → 判为 legacy(即便来自另一份 web3.js 副本也成立)", () => {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: Keypair.generate().publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1000,
      }),
    );
    tx.feePayer = Keypair.generate().publicKey;
    tx.recentBlockhash = SystemProgram.programId.toBase58();
    expect(isVersionedTransaction(tx)).toBe(false);
    // legacy 无 message 属性——正是双包场景下 instanceof 误判后崩溃的读取点
    expect((tx as unknown as { message?: unknown }).message).toBeUndefined();
  });

  it("V0 VersionedTransaction → 判为 versioned", () => {
    const message = new TransactionMessage({
      payerKey: Keypair.generate().publicKey,
      recentBlockhash: SystemProgram.programId.toBase58(),
      instructions: [],
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    expect(isVersionedTransaction(tx)).toBe(true);
  });

  it("accountKeysOf 对 legacy 交易走 nonProgramIds(不依赖 instanceof)", () => {
    const from = Keypair.generate().publicKey;
    const to = Keypair.generate().publicKey;
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: 1000 }),
    );
    tx.feePayer = from;
    tx.recentBlockhash = SystemProgram.programId.toBase58();
    const keys = accountKeysOf(tx);
    // nonProgramIds = [feePayer(签名者), to(可写)];SystemProgram 属于 programIds 被排除
    expect(keys.map((k) => k.toBase58())).toEqual([from.toBase58(), to.toBase58()]);
  });
});
