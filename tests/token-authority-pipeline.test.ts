/**
 * 验收测试来源：审计探针 tests/__auditor2-probe.tmp.test.ts（写于 2026-10-10，早于当日 P1–P3 修复）。
 *
 * 反转说明（依据 a5030c6 解析器泛化 + 38dbf58 分级/指纹）：
 *  - 探针 C（approve u64::MAX → concerns 为空）已失效：parser 解码 tokenAuthorityOps，
 *    credibility 发 TOKEN_APPROVE(high) → strict deny；monitor 降级 escalate(tier=confirm)。
 *  - 探针 D（transfer + close ATA 仅日志）已失效：TOKEN_CLOSE_ACCOUNT(high) → strict deny；
 *    保留子事实断言：净流入场景 simulation 门无 drain 疑点。
 *  - 探针 B（无 purpose/无 amount 仅日志）升级为断言：PURPOSE_REQUIRED(high) +
 *    TOKEN_AMOUNT_UNDECLARED(medium) → strict deny。
 *  - 探针 F 注释“approve/close not decoded”过期：tokenAuthorityOps 现含 approve/close_account。
 *
 * 未修复缺口（探针 A：token 价值不计量；探针 E：非 wallet 账户 SOL 流失仍静默）未写入本测试，
 * 按流程记入 backlog。
 */
import {
  AccountInfo,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { classifyActions, parseTransaction } from "../src/parser";
import { Firewall } from "../src/validate";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** SPL Transfer (type 3, amount u64 LE)：keys = [source(w), destination(w), authority(s)] */
function splTransferIx(
  source: PublicKey,
  dest: PublicKey,
  authority: PublicKey,
  rawAmount: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data[0] = 3;
  data.writeBigUInt64LE(rawAmount, 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

/** SPL Approve (type 4, amount u64 LE)：keys = [source(w), delegate(r), owner(s)] */
function splApproveIx(
  source: PublicKey,
  delegate: PublicKey,
  owner: PublicKey,
  rawAmount: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data[0] = 4;
  data.writeBigUInt64LE(rawAmount, 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: delegate, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

/** SPL CloseAccount (type 9)：keys = [account(w), destination(w), owner(s)] */
function splCloseIx(account: PublicKey, dest: PublicKey, owner: PublicKey): TransactionInstruction {
  const data = Buffer.alloc(1);
  data[0] = 9;
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

interface SimAccount {
  lamports: number;
  owner: string;
  data: string[];
  executable: boolean;
  rentEpoch: number;
}

class FakeConnection {
  postStates: (SimAccount | null)[] = [];
  preStates: (AccountInfo<Buffer> | null)[] = [];
  async simulateTransaction(): Promise<{
    context: unknown;
    value: { err: string | null; accounts: (SimAccount | null)[] | null; logs: string[]; unitsConsumed: number };
  }> {
    return { context: { slot: 1 }, value: { err: null, accounts: this.postStates, logs: [], unitsConsumed: 0 } };
  }
  async getMultipleAccountsInfo(): Promise<(AccountInfo<Buffer> | null)[]> {
    return this.preStates;
  }
  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return { blockhash: "1".repeat(32), lastValidBlockHeight: 100 };
  }
}

function accountInfo(lamports: number, owner: PublicKey): AccountInfo<Buffer> {
  return { lamports, owner, data: Buffer.alloc(0), executable: false, rentEpoch: 0 };
}
function simAccount(lamports: number, owner: PublicKey): SimAccount {
  return { lamports, owner: owner.toBase58(), data: [], executable: false, rentEpoch: 0 };
}

describe("token 权限操作管线（探针 C 反转：approve 盲区已关闭）", () => {
  it("approve u64::MAX → TOKEN_APPROVE(high) → strict deny", async () => {
    const wallet = Keypair.generate().publicKey;
    const tx = new Transaction().add(
      splApproveIx(Keypair.generate().publicKey, Keypair.generate().publicKey, wallet, 2n ** 64n - 1n),
    );
    tx.feePayer = wallet;
    tx.recentBlockhash = "1".repeat(32);

    const r = await new Firewall().validateTransaction({
      action: "custom",
      wallet: wallet.toBase58(),
      transaction: tx,
    });
    // 反转自探针断言 expect(concerns).toHaveLength(0)
    const concern = r.concerns.find((c) => c.id === "TOKEN_APPROVE");
    expect(concern?.severity).toBe("high");
    expect(concern?.details?.amount).toBe("18446744073709551615");
    expect(r.shouldProceed).toBe(false);
    expect(r.requiresConfirmation).toBe(false);
    expect(r.tier).toBe("deny");
    expect(r.fingerprint).not.toBeNull();
    expect(r.decisions.find((d) => d.gate === "credibility")!.verdict).toBe("deny");
  });

  it("approve u64::MAX → monitor 降级为 escalate（requiresConfirmation + tier=confirm）", async () => {
    const wallet = Keypair.generate().publicKey;
    const tx = new Transaction().add(
      splApproveIx(Keypair.generate().publicKey, Keypair.generate().publicKey, wallet, 2n ** 64n - 1n),
    );
    tx.feePayer = wallet;
    tx.recentBlockhash = "1".repeat(32);

    const r = await new Firewall({ mode: "monitor" }).validateTransaction({
      action: "custom",
      wallet: wallet.toBase58(),
      transaction: tx,
    });
    expect(r.shouldProceed).toBe(false);
    expect(r.requiresConfirmation).toBe(true);
    expect(r.tier).toBe("confirm");
    expect(r.concerns.some((c) => c.id === "TOKEN_APPROVE")).toBe(true);
    expect(r.decisions.find((d) => d.gate === "credibility")!.verdict).toBe("escalate");
  });
});

describe("token 权限操作管线（探针 B 反转：无声明 token 转账不再静默）", () => {
  it("无 purpose/无 amount 的 SPL Transfer → PURPOSE_REQUIRED(high) + TOKEN_AMOUNT_UNDECLARED(medium) → strict deny", async () => {
    const wallet = Keypair.generate().publicKey;
    const tx = new Transaction().add(
      splTransferIx(
        Keypair.generate().publicKey,
        Keypair.generate().publicKey,
        Keypair.generate().publicKey,
        1n,
      ),
    );
    tx.feePayer = wallet;
    tx.recentBlockhash = "1".repeat(32);

    const r = await new Firewall().validateTransaction({
      action: "custom",
      wallet: wallet.toBase58(),
      transaction: tx,
    });
    const purpose = r.concerns.find((c) => c.id === "PURPOSE_REQUIRED");
    expect(purpose?.severity).toBe("high");
    const undeclared = r.concerns.find((c) => c.id === "TOKEN_AMOUNT_UNDECLARED");
    expect(undeclared?.severity).toBe("medium");
    expect(r.shouldProceed).toBe(false);
    expect(r.requiresConfirmation).toBe(false);
    expect(r.tier).toBe("deny");
    expect(r.decisions.find((d) => d.gate === "worth")!.verdict).toBe("deny");
    expect(r.decisions.find((d) => d.gate === "limits")!.verdict).toBe("escalate");
  });
});

describe("token 权限操作管线（探针 D 反转：close ATA 不再静默）", () => {
  it("transfer + close ATA（模拟净流入）→ TOKEN_CLOSE_ACCOUNT(high) deny；sim 门无 drain 疑点", async () => {
    const wallet = Keypair.generate().publicKey;
    const ata = Keypair.generate().publicKey;
    const destAta = Keypair.generate().publicKey;
    const tx = new Transaction().add(
      splTransferIx(ata, destAta, wallet, 999n),
      splCloseIx(ata, wallet, wallet),
    );
    tx.feePayer = wallet;
    tx.recentBlockhash = "1".repeat(32);

    const keys = tx.compileMessage().nonProgramIds().map((k) => k.toBase58());
    const fake = new FakeConnection();
    // wallet 收到租金退款(+2_034_280) → 净流入；其余账户 lamports 不变
    fake.postStates = keys.map((k) =>
      k === wallet.toBase58() ? simAccount(2_034_280, SystemProgram.programId) : simAccount(0, TOKEN_PROGRAM_ID),
    );
    fake.preStates = keys.map((k) =>
      k === wallet.toBase58() ? accountInfo(0, SystemProgram.programId) : accountInfo(0, TOKEN_PROGRAM_ID),
    );

    const r = await new Firewall(
      {
        amountUnit: "lamports",
        maxTransactionAmount: 10_000,
        confirmationThreshold: 10_000,
        dailyLimit: 100_000,
        simulationFeeTolerance: 5000,
      },
      { connection: fake as unknown as Connection },
    ).validateTransaction({
      action: "custom",
      amount: 0,
      purpose: "x",
      wallet: wallet.toBase58(),
      transaction: tx,
    });

    const close = r.concerns.find((c) => c.id === "TOKEN_CLOSE_ACCOUNT");
    expect(close?.severity).toBe("high");
    expect(r.shouldProceed).toBe(false);
    expect(r.tier).toBe("deny");
    expect(r.fingerprint).not.toBeNull();

    // 保留子事实：净流入场景 simulation 门本身无疑点（拦截来自 L1 静态层）
    const sim = r.decisions.find((d) => d.gate === "simulation")!;
    expect(sim.verdict).toBe("allow");
    expect(sim.concerns.some((c) => c.id === "UNEXPECTED_DRAIN" || c.id === "DRAIN_MISMATCH")).toBe(false);
  });
});

describe("parser tokenAuthorityOps（探针 F 反转：approve/close 已解码）", () => {
  it("tokenTransfers==1 且 tokenAuthorityOps 含 approve/close_account", () => {
    const a = Keypair.generate().publicKey;
    const b = Keypair.generate().publicKey;
    const c = Keypair.generate().publicKey;
    const tx = new Transaction()
      .add(splTransferIx(a, b, c, 5n))
      .add(splApproveIx(a, b, c, 5n))
      .add(splCloseIx(a, b, c));

    const parsed = parseTransaction(tx);
    expect(parsed.tokenTransfers).toHaveLength(1);
    // 反转自探针注释“approve/close not decoded”：两者现进入 tokenAuthorityOps
    expect(parsed.tokenAuthorityOps).toHaveLength(2);
    expect(parsed.tokenAuthorityOps.map((o) => o.kind)).toEqual(["approve", "close_account"]);
    expect(parsed.tokenAuthorityOps[0]!.counterparty).toBe(b.toBase58());
    expect(parsed.tokenAuthorityOps[0]!.amount).toBe("5");
    // close_account 的 counterparty = keys[1]（退款收款方 dest）
    expect(parsed.tokenAuthorityOps[1]!.counterparty).toBe(b.toBase58());

    const actions = classifyActions(parsed);
    expect(actions).toContain("token_transfer");
    expect(actions).toContain("token_approve");
    expect(actions).toContain("close_account");
  });
});
