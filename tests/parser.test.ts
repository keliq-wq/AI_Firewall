import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { classifyActions, parseTransaction } from "../src/parser";

describe("parser — 交易离线解析", () => {
  it("解析原生转账（from/to/lamports）", () => {
    const to = Keypair.generate().publicKey;
    const from = Keypair.generate().publicKey;
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: 1_000_000 }));
    const parsed = parseTransaction(tx);
    expect(parsed.nativeTransfers).toHaveLength(1);
    expect(parsed.nativeTransfers[0]!.to).toBe(to.toBase58());
    expect(parsed.nativeTransfers[0]!.lamports).toBe(1_000_000);
    expect(parsed.programIds).toContain(SystemProgram.programId.toBase58());
  });

  it("解析 assign → ownerChanges（via: assign）", () => {
    const account = Keypair.generate().publicKey;
    const newOwner = Keypair.generate().publicKey;
    const tx = new Transaction().add(SystemProgram.assign({ accountPubkey: account, programId: newOwner }));
    const parsed = parseTransaction(tx);
    expect(parsed.ownerChanges).toHaveLength(1);
    expect(parsed.ownerChanges[0]!.newOwner).toBe(newOwner.toBase58());
    expect(parsed.ownerChanges[0]!.via).toBe("assign");
  });

  it("classifyActions 从解析结果推导敏感操作", () => {
    const tx = new Transaction().add(
      SystemProgram.assign({
        accountPubkey: Keypair.generate().publicKey,
        programId: Keypair.generate().publicKey,
      }),
    );
    const actions = classifyActions(parseTransaction(tx));
    expect(actions).toContain("assign_owner");
  });
});
