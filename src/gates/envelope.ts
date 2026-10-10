import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ParsedTransaction } from "../parser";
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
 *   - 有转出但无声明 → deny（UNDECLARED_OUTFLOW）——「未声明不记账」的反面
 *   - 收款方与声明不符 → medium concern（叙述层，不直接 deny——收款方可能为
 *     多笔/中间账户，静态层不做过度判定）
 */
export function envelopeGate(
  intent: TransactionIntent,
  parsed: ParsedTransaction,
  policy: ResolvedPolicy,
): GateDecision {
  const concerns: Concern[] = [];
  const wallet = intent.wallet;
  if (!wallet) {
    concerns.push({
      id: "WALLET_UNDECLARED",
      severity: "low",
      message: "Declare intent.wallet to enable envelope cross-checks offline",
    });
    return { gate: "envelope", verdict: "allow", concerns };
  }

  const declared = parseAmount(intent.amount);
  const toSol = (lamports: number) => lamports / LAMPORTS_PER_SOL;

  const outflows = parsed.nativeTransfers.filter((t) => t.from === wallet);
  const totalOutflow = outflows.reduce((sum, t) => sum + t.lamports, 0);

  if (totalOutflow > 0) {
    const outflowSol = toSol(totalOutflow);
    if (declared == null) {
      concerns.push({
        id: "UNDECLARED_OUTFLOW",
        severity: "high",
        message: `Wallet ${wallet} transfers ${outflowSol} SOL but no amount is declared — the firewall cannot verify this against an envelope`,
        details: { wallet, outflow: outflowSol },
      });
    } else if (outflowSol > declared) {
      concerns.push({
        id: "AMOUNT_EXCEEDS_ENVELOPE",
        severity: "high",
        message: `Declared amount ${declared} is exceeded by the actual transfer ${outflowSol} SOL — the declaration cannot be trusted`,
        details: { wallet, declared, actual: outflowSol },
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
