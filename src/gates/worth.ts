import { classifyActions, ParsedTransaction } from "../parser";
import { ResolvedPolicy } from "../policy";
import { Concern, GateDecision, TransactionIntent, Verdict } from "../types";
import { dedupe, verdictForSeverity, worstVerdict } from "./util";
import { parseAmount } from "./limits";

/**
 * Worth 门（意图价值）：敏感操作必须提供业务理由（purpose）。
 * 这是对提示注入的语义层防御——攻击者诱导 Agent 转账时通常无法提供合理理由。
 *
 * 硬基线（不可通过配置关闭）：owner 变更、建户、代币转账必须提供 purpose，
 * 即使 requirePurposeFor 为空也会强制要求。
 */
const ALWAYS_SENSITIVE = new Set(["assign_owner", "create_account", "token_transfer"]);

export function worthGate(
  intent: TransactionIntent,
  parsed: ParsedTransaction,
  policy: ResolvedPolicy,
): GateDecision {
  const concerns: Concern[] = [];

  const actions = dedupe([intent.action, ...classifyActions(parsed)]);
  const sensitive = new Set(policy.requirePurposeFor);
  const required = actions.filter((a) => sensitive.has(a) || ALWAYS_SENSITIVE.has(a));

  const amount = parseAmount(intent.amount);
  const aboveThreshold = amount != null && amount > policy.requirePurposeAbove;
  const needsPurpose = required.length > 0 || aboveThreshold;

  if (needsPurpose && !intent.purpose) {
    concerns.push({
      id: "PURPOSE_REQUIRED",
      severity: "high",
      message: `Sensitive action(s) [${required.join(", ")}]${aboveThreshold ? ` (amount ${amount} above purpose threshold)` : ""} require a business purpose; none provided`,
      details: { actions, amount, requirePurposeAbove: policy.requirePurposeAbove },
    });
  } else if (intent.purpose) {
    concerns.push({
      id: "PURPOSE_RECORDED",
      severity: "low",
      message: `Business purpose recorded: ${intent.purpose}`,
      details: { purpose: intent.purpose },
    });
  }

  let verdict: Verdict = "allow";
  for (const c of concerns) verdict = worstVerdict(verdict, verdictForSeverity(c.severity, policy.mode));
  return { gate: "worth", verdict, concerns };
}
