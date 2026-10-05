import { ParsedTransaction } from "../parser";
import { ResolvedPolicy } from "../policy";
import { Concern, GateDecision, TransactionIntent, Verdict } from "../types";
import { dedupe, verdictForSeverity, worstVerdict } from "./util";

/**
 * Credibility 门（可信度）：程序白名单 + Solana 特有 owner 变更检测。
 * owner 静默转移是 Solana 账户模型的特有攻击面（2024 Q4 同比 +320%），
 * 是本防火墙的核心差异化能力。
 */
export function credibilityGate(
  intent: TransactionIntent,
  parsed: ParsedTransaction,
  policy: ResolvedPolicy,
): GateDecision {
  const concerns: Concern[] = [];
  const programIds = dedupe([...(intent.programIds ?? []), ...parsed.programIds]);

  // 地址查找表未解析 → 程序集合可能不完整，无法完整校验
  if (parsed.unresolvedLookups) {
    concerns.push({
      id: "ALT_UNRESOLVED",
      severity: "medium",
      message:
        "Transaction contains unresolved address lookup tables (ALT); the program set may be incomplete",
    });
  }

  // 程序白名单（allowlist 模式：非空时启用）
  if (policy.allowedPrograms.length > 0) {
    for (const program of programIds) {
      if (!policy.allowedPrograms.includes(program)) {
        concerns.push({
          id: "PROGRAM_NOT_ALLOWED",
          severity: "high",
          message: `Transaction calls program ${program} which is not in the allowlist`,
          details: { program },
        });
      }
    }
  }

  // owner 变更检测（核心）：识别 owner 被重定向至黑名单/白名单/未验证程序
  for (const change of parsed.ownerChanges) {
    if (policy.blockedPrograms.includes(change.newOwner)) {
      concerns.push({
        id: "OWNER_CHANGE_BLOCKED",
        severity: "critical",
        message: `Account ${change.account} owner would be reassigned to blocked program ${change.newOwner} (${change.via})`,
        details: { account: change.account, newOwner: change.newOwner, via: change.via },
      });
    } else if (policy.allowedPrograms.includes(change.newOwner)) {
      concerns.push({
        id: "OWNER_CHANGE_WHITELISTED",
        severity: "medium",
        message: `Account ${change.account} owner will be reassigned to allowlisted program ${change.newOwner} (${change.via}); human confirmation required`,
        details: { account: change.account, newOwner: change.newOwner, via: change.via },
      });
    } else {
      concerns.push({
        id: "OWNER_CHANGE",
        severity: "high",
        message: `Account ${change.account} owner would be reassigned to unverified program ${change.newOwner} (${change.via}) — classic owner-phishing pattern unless intentional`,
        details: { account: change.account, newOwner: change.newOwner, via: change.via },
      });
    }
  }

  let verdict: Verdict = "allow";
  for (const c of concerns) verdict = worstVerdict(verdict, verdictForSeverity(c.severity, policy.mode));
  return { gate: "credibility", verdict, concerns };
}
