/**
 * 验收测试来源：证伪探针 tests/__refuter-alt-probe.tmp.test.ts
 *（写于 2026-10-10，早于当日修复；ALT 解析行为自 dc539b4 首提交即存在，未因 P1–P3 改变）。
 *
 * 保留回归断言：
 *  - 探针 #1：parser 对 V0+ALT 标记 unresolvedLookups（程序集合不完整可见）；
 *  - 对照：strict + allowlist 对 V0 静态程序的 deny 生效（无 ALT 时不因 V0 而失效）；
 *  - 基线：全部命中 allowlist 的 V0 交易正常放行。
 *
 * 未修复缺口——strict+allowlist 下 ALT 隐匿的非白名单程序仅到 escalate（不 deny/不 allow），
 * 及“谎报 programIds 仍 escalate”等矩阵——未写入本测试，按流程记入 backlog
 *（docs/INVARIANTS.md §5 已挂账）。
 */
import {
  AddressLookupTableAccount,
  Keypair,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { parseTransaction } from "../src/parser";
import { Firewall } from "../src/validate";

const HIDDEN_PROGRAM = Keypair.generate().publicKey; // 非白名单“恶意”程序
const DATA_ACCOUNT = Keypair.generate().publicKey;

/** V0 交易：隐藏程序（可选藏进 ALT）+ 一笔 SystemProgram 转账 */
function v0WithAlt(hiddenProgramInAlt: boolean): VersionedTransaction {
  const payer = Keypair.generate().publicKey;
  const ixs = [
    new TransactionInstruction({
      programId: HIDDEN_PROGRAM,
      keys: [{ pubkey: DATA_ACCOUNT, isSigner: false, isWritable: true }],
      data: Buffer.from([9, 9, 9]),
    }),
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  ];
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: ixs,
  }).compileToV0Message(
    hiddenProgramInAlt
      ? [
          new AddressLookupTableAccount({
            key: Keypair.generate().publicKey,
            state: {
              deactivationSlot: BigInt("18446744073709551615"),
              lastExtendedSlot: 0,
              lastExtendedSlotStartIndex: 0,
              authority: undefined,
              addresses: [HIDDEN_PROGRAM, DATA_ACCOUNT],
            },
          } as never),
        ]
      : [],
  );
  return new VersionedTransaction(msg);
}

const ALLOWLIST = [SystemProgram.programId.toBase58()];

describe("ALT 与 allowlist（探针 #1 回归 + V0 对照）", () => {
  it("parser：V0+ALT → unresolvedLookups=true；无 ALT → 完整解析", () => {
    expect(parseTransaction(v0WithAlt(true)).unresolvedLookups).toBe(true);
    const parsedPlain = parseTransaction(v0WithAlt(false));
    expect(parsedPlain.unresolvedLookups).toBe(false);
    expect(parsedPlain.programIds).toContain(HIDDEN_PROGRAM.toBase58());
    expect(parsedPlain.programIds).toContain(SystemProgram.programId.toBase58());
  });

  it("strict + allowlist：V0（无 ALT）调用非白名单程序 → PROGRAM_NOT_ALLOWED(high) deny", async () => {
    const fw = new Firewall({ mode: "strict", allowedPrograms: ALLOWLIST });
    const res = await fw.validateTransaction({
      action: "swap",
      amount: 1,
      purpose: "probe",
      transaction: v0WithAlt(false),
    });
    const concern = res.concerns.find((c) => c.id === "PROGRAM_NOT_ALLOWED");
    expect(concern?.severity).toBe("high");
    expect(concern?.details?.program).toBe(HIDDEN_PROGRAM.toBase58());
    expect(res.shouldProceed).toBe(false);
    expect(res.tier).toBe("deny");
    expect(res.fingerprint).not.toBeNull();
  });

  it("基线：V0 仅调用白名单内程序 → 放行", async () => {
    const payer = Keypair.generate();
    const to = Keypair.generate().publicKey;
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [
        SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports: 1 }),
      ],
    }).compileToV0Message();
    const fw = new Firewall({ mode: "strict", allowedPrograms: ALLOWLIST });
    const res = await fw.validateTransaction({
      action: "transfer",
      amount: 1e-9, // 实际转出 1 lamport
      recipient: to.toBase58(), // 与交易一致(否则 RECIPIENT_MISMATCH)
      purpose: "probe",
      wallet: payer.publicKey.toBase58(),
      transaction: new VersionedTransaction(msg),
    });
    expect(res.shouldProceed).toBe(true);
    expect(res.concerns.some((c) => c.id === "PROGRAM_NOT_ALLOWED")).toBe(false);
  });
});
