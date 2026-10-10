import { LAMPORTS_PER_SOL, Transaction, VersionedTransaction } from "@solana/web3.js";
import { isVersionedTransaction, ParsedTransaction } from "../parser";
import { ResolvedPolicy } from "../policy";
import { Concern, GateDecision, TransactionIntent, Verdict } from "../types";
import { parseAmount } from "./limits";
import { verdictForSeverity, worstVerdict } from "./util";

/**
 * Envelope 门（信封纪律）：声明(信封)只作上限，永不当事实。
 *
 * 修复「自证陷阱」的离线半边：Agent 自述的金额/收款方与交易静态解析出的
 * 真实转出做交叉核对——被注入的模型可以伪造声明，但伪造不了解析事实。
 *
 * 判定方向铁律：效果 ⊆ 信封 ⊆ 策略上限。
 *   - 解析出 wallet 的转出 > 声明金额 → deny（AMOUNT_EXCEEDS_ENVELOPE）
 *   - 有转出但无声明 → deny（UNDECLARED_OUTFLOW）
 *   - 收款方与声明不符 → medium concern（叙述层）
 *   - wallet 未声明 → 从交易 fee payer 推导（封死「省略 wallet 即绕过」）;
 *     声明 wallet 与 fee payer 不符 → medium concern
 *   - 金额比较按 policy.amountUnit 折算（审计响应:lamports 模式下原实现静默关闭）
 */
export function envelopeGate(
  intent: TransactionIntent,
  parsed: ParsedTransaction,
  policy: ResolvedPolicy,
): GateDecision {
  const concerns: Concern[] = [];

  // 有效钱包:声明的 wallet,缺失时从交易 fee payer 推导(可伪造的事实来源)
  const feePayer = feePayerOf(intent.transaction);
  const declaredWallet = intent.wallet;
  const wallet = declaredWallet ?? feePayer;

  if (!wallet) {
    concerns.push({
      id: "WALLET_UNDECLARED",
      severity: "medium", // 审计响应:从 low 升为 medium——省略 wallet 不再静默放行
      message: "No wallet declared and no fee payer derivable — envelope cross-checks skipped; declaration cannot be trusted",
    });
    return {
      gate: "envelope",
      verdict: verdictForSeverity("medium", policy.mode),
      concerns,
    };
  }

  if (declaredWallet && feePayer && declaredWallet !== feePayer) {
    concerns.push({
      id: "WALLET_MISMATCH",
      severity: "medium",
      message: `Declared wallet ${declaredWallet} is not the transaction fee payer ${feePayer} — the declaration may be a decoy`,
      details: { declared: declaredWallet, feePayer },
    });
  }

  const declared = parseAmount(intent.amount);
  const isSol = policy.amountUnit === "sol";
  const toUnit = (lamports: number) => (isSol ? lamports / LAMPORTS_PER_SOL : lamports);
  const unitLabel = isSol ? "SOL" : "lamports";

  const outflows = parsed.nativeTransfers.filter((t) => t.from === wallet);
  const totalOutflow = outflows.reduce((sum, t) => sum + t.lamports, 0);

  if (totalOutflow > 0) {
    const outflow = toUnit(totalOutflow);
    if (declared == null) {
      concerns.push({
        id: "UNDECLARED_OUTFLOW",
        severity: "high",
        message: `Wallet ${wallet} transfers ${outflow} ${unitLabel} but no amount is declared — the firewall cannot verify this against an envelope`,
        details: { wallet, outflow },
      });
    } else if (outflow > declared) {
      concerns.push({
        id: "AMOUNT_EXCEEDS_ENVELOPE",
        severity: "high",
        message: `Declared amount ${declared} is exceeded by the actual transfer ${outflow} ${unitLabel} — the declaration cannot be trusted`,
        details: { wallet, declared, actual: outflow },
      });
    }
  }

  // 收款方核对（叙述层）：声明收款方不在解析出的转出收款方集合中
  if (intent.recipient && outflows.length > 0) {
    const recipients = new Set(outflows.map((t) => t.to));
    if (!recipients.has(intent.recipient)) {
      concerns.push({
        id: "RECIPIENT_MISMATCH",
        severity: "medium",
        message: `Declared recipient ${intent.recipient} does not appear in the parsed transfers; actual recipients: ${[...recipients].join(", ")}`,
        details: { declared: intent.recipient, actual: [...recipients] },
      });
    }
  }

  let verdict: Verdict = "allow";
  for (const c of concerns) verdict = worstVerdict(verdict, verdictForSeverity(c.severity, policy.mode));
  return { gate: "envelope", verdict, concerns };
}

/** 交易 fee payer:legacy 取 tx.feePayer;V0 取消息首键(付费者) */
function feePayerOf(tx?: Transaction | VersionedTransaction): string | undefined {
  if (!tx) return undefined;
  if (isVersionedTransaction(tx)) {
    return tx.message.staticAccountKeys[0]?.toBase58();
  }
  return tx.feePayer?.toBase58();
}
