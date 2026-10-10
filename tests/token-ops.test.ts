import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { classifyActions, parseTransaction } from "../src/parser";
import { credibilityGate } from "../src/gates/credibility";
import { resolvePolicy } from "../src/policy";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

function tokenIx(tag: number, keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[], data: Buffer): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys,
    data: Buffer.concat([Buffer.from([tag]), data]),
  });
}

const amt = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n, 0);
  return b;
};

describe("parser — Token 指令解码(泛化修复)", () => {
  it("Transfer(3):keys=[src,dst,authority],mint 不在指令中", () => {
    const [src, dst, owner] = [Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey];
    const tx = new Transaction().add(
      tokenIx(3, [
        { pubkey: src, isSigner: false, isWritable: true },
        { pubkey: dst, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ], amt(500n)),
    );
    const parsed = parseTransaction(tx);
    expect(parsed.tokenTransfers).toHaveLength(1);
    expect(parsed.tokenTransfers[0]!.source).toBe(src.toBase58());
    expect(parsed.tokenTransfers[0]!.dest).toBe(dst.toBase58());
    expect(parsed.tokenTransfers[0]!.mint).toBe(""); // Transfer 无 mint 账户
    expect(parsed.tokenTransfers[0]!.amount).toBe("500");
  });

  it("TransferChecked(12):keys=[src,mint,dst,authority],mint 正确解析", () => {
    const [src, mint, dst, owner] = [Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey];
    const tx = new Transaction().add(
      tokenIx(12, [
        { pubkey: src, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: dst, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ], Buffer.concat([amt(700n), Buffer.from([6])])),
    );
    const parsed = parseTransaction(tx);
    expect(parsed.tokenTransfers[0]!.mint).toBe(mint.toBase58());
    expect(parsed.tokenTransfers[0]!.dest).toBe(dst.toBase58());
  });

  it("Approve(4):识别为代币授权操作并归入敏感类别", () => {
    const [src, delegate, owner] = [Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey];
    const tx = new Transaction().add(
      tokenIx(4, [
        { pubkey: src, isSigner: false, isWritable: true },
        { pubkey: delegate, isSigner: false, isWritable: false },
        { pubkey: owner, isSigner: true, isWritable: false },
      ], amt(2n ** 64n - 1n)), // u64::MAX 无限授权
    );
    const parsed = parseTransaction(tx);
    expect(parsed.tokenAuthorityOps).toHaveLength(1);
    expect(parsed.tokenAuthorityOps[0]!.kind).toBe("approve");
    expect(parsed.tokenAuthorityOps[0]!.counterparty).toBe(delegate.toBase58());
    expect(classifyActions(parsed)).toContain("token_approve");
  });

  it("SetAuthority(6)/CloseAccount(9) 被识别", () => {
    const [acct, owner] = [Keypair.generate().publicKey, Keypair.generate().publicKey];
    const tx = new Transaction().add(
      tokenIx(6, [
        { pubkey: acct, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ], Buffer.from([2])),
      tokenIx(9, [
        { pubkey: acct, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ], Buffer.alloc(0)),
    );
    const parsed = parseTransaction(tx);
    const kinds = parsed.tokenAuthorityOps.map((o) => o.kind);
    expect(kinds).toContain("set_authority");
    expect(kinds).toContain("close_account");
  });
});

describe("credibility — createAccount 与 assign 区分(误报修复)", () => {
  const policy = resolvePolicy({});

  it("createAccount(正常建户)不再被当作 owner 钓鱼 → verdict allow", () => {
    const payer = Keypair.generate().publicKey;
    const newAcct = Keypair.generate().publicKey;
    const program = Keypair.generate().publicKey;
    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: new PublicKey("11111111111111111111111111111111"),
        keys: [
          { pubkey: payer, isSigner: true, isWritable: true },
          { pubkey: newAcct, isSigner: true, isWritable: true },
        ],
        data: Buffer.from([0, ...new Uint8Array(new Array(8).fill(0)), ...new Uint8Array(new Array(8).fill(0)), ...program.toBytes()]),
      }),
    );
    const parsed = parseTransaction(tx);
    expect(parsed.ownerChanges).toHaveLength(1);
    const decision = credibilityGate({ action: "custom", transaction: tx }, parsed, policy);
    expect(decision.verdict).toBe("allow");
    expect(decision.concerns.some((c) => c.id === "ACCOUNT_CREATED" && c.severity === "low")).toBe(true);
  });

  it("assign(owner 改向)仍为高危拦截", () => {
    const account = Keypair.generate().publicKey;
    const attackerProgram = Keypair.generate().publicKey;
    const tx = new Transaction().add(SystemProgram.assign({ accountPubkey: account, programId: attackerProgram }));
    const parsed = parseTransaction(tx);
    const decision = credibilityGate({ action: "custom", transaction: tx }, parsed, policy);
    expect(decision.verdict).toBe("deny");
    expect(decision.concerns.some((c) => c.id === "OWNER_CHANGE" && c.severity === "high")).toBe(true);
  });
});
