import { ParsedTransaction } from "../parser";
import { ResolvedPolicy } from "../policy";
import { Concern, GateDecision, TransactionIntent, Verdict } from "../types";
import { dedupe, verdictForSeverity, worstVerdict } from "./util";

/**
 * Avoidance 门（规避）：程序/地址黑名单。
 * 命中即 critical deny，无视 mode——这是优先级最高的硬拦截。
 */
export function avoidanceGate(
  intent: TransactionIntent,
  parsed: ParsedTransaction,
  policy: ResolvedPolicy,
): GateDecision {
  const concerns: Concern[] = [];

  const blockedPrograms = new Set(policy.blockedPrograms);
  for (const program of dedupe([...(intent.programIds ?? []), ...parsed.programIds])) {
    if (blockedPrograms.has(program)) {
      concerns.push({
        id: "BLOCKED_PROGRAM",
        severity: "critical",
        message: `Transaction touches blocked program ${program}`,
        details: { program },
      });
    }
  }

  const blockedAddresses = new Set(policy.blockedAddresses);
  const candidates = dedupe([
    ...(intent.recipient ? [intent.recipient] : []),
    ...parsed.nativeTransfers.map((t) => t.to),
    ...parsed.tokenTransfers.map((t) => t.dest),
    ...parsed.accountKeys,
  ]);
  for (const address of candidates) {
    if (blockedAddresses.has(address)) {
      concerns.push({
        id: "BLOCKED_ADDRESS",
        severity: "critical",
        message: `Transaction touches blocked address ${address}`,
        details: { address },
      });
    }
  }

  let verdict: Verdict = "allow";
  for (const c of concerns) verdict = worstVerdict(verdict, verdictForSeverity(c.severity, policy.mode));
  return { gate: "avoidance", verdict, concerns };
}
