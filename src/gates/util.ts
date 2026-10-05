import { Severity, Verdict } from "../types";

export const VERDICT_RANK: Record<Verdict, number> = { allow: 0, escalate: 1, deny: 2 };

export const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function worstVerdict(a: Verdict, b: Verdict): Verdict {
  return VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b;
}

/**
 * 严重度 → 判定映射（default-deny 姿态）：
 * - critical 一律 deny（无视 mode）
 * - high 在 strict 下 deny，monitor 下 escalate
 * - medium 一律 escalate（需人工确认）
 * - low 放行（仅记录）
 */
export function verdictForSeverity(severity: Severity, mode: "strict" | "monitor"): Verdict {
  switch (severity) {
    case "critical":
      return "deny";
    case "high":
      return mode === "strict" ? "deny" : "escalate";
    case "medium":
      return "escalate";
    default:
      return "allow";
  }
}

export function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
