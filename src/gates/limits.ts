import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ParsedTransaction } from "../parser";
import { ResolvedPolicy } from "../policy";
import { Concern, GateDecision, TransactionIntent, Verdict } from "../types";
import { verdictForSeverity, worstVerdict } from "./util";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 金额解析：number 或数字字符串；非法输入返回 null */
export function parseAmount(raw: number | string | undefined): number | null {
  if (raw == null) return null;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * 滚动支出记账键：优先幂等键；缺省按 action + 收款方推导，
 * 使同一意图重复校验时幂等（不重复计入 24h 滚动支出）。
 */
export function deriveSpendKey(intent: TransactionIntent, parsed: ParsedTransaction): string {
  return (
    intent.idempotencyKey ??
    `${intent.action}:${parsed.nativeTransfers.map((t) => t.to).join(",") || intent.recipient || "?"}`
  );
}

/**
 * Limits 门（限额）：单笔上限、确认阈值、24h 滚动支出。
 * 意图未声明金额时从原生转账推导；代币部分离线无法折算，标记待 Layer 2 处理。
 */
export async function limitsGate(
  intent: TransactionIntent,
  parsed: ParsedTransaction,
  policy: ResolvedPolicy,
): Promise<GateDecision> {
  const concerns: Concern[] = [];

  if (intent.amount != null && parseAmount(intent.amount) == null) {
    concerns.push({
      id: "AMOUNT_INVALID",
      severity: "medium",
      message: `Declared amount ${String(intent.amount)} could not be parsed; limits checks skipped`,
      details: { raw: intent.amount },
    });
  }

  let amount = parseAmount(intent.amount);
  if (amount == null) {
    const lamports = parsed.nativeTransfers.reduce((sum, t) => sum + t.lamports, 0);
    if (lamports > 0) {
      amount = lamports / (policy.amountUnit === "sol" ? LAMPORTS_PER_SOL : 1);
    }
  }

  if (parsed.tokenTransfers.length > 0 && intent.amount == null) {
    concerns.push({
      id: "TOKEN_AMOUNT_UNDECLARED",
      severity: "medium",
      message: `Transaction contains ${parsed.tokenTransfers.length} token transfer(s) with no declared amount; limits do not cover token value`,
      details: { mints: parsed.tokenTransfers.map((t) => t.mint) },
    });
  }

  if (amount != null) {
    if (amount > policy.maxTransactionAmount) {
      concerns.push({
        id: "AMOUNT_EXCEEDS_MAX",
        severity: "high",
        message: `Amount ${amount} exceeds per-transaction cap ${policy.maxTransactionAmount}`,
        details: { amount, max: policy.maxTransactionAmount },
      });
    } else if (amount > policy.confirmationThreshold) {
      concerns.push({
        id: "CONFIRMATION_REQUIRED",
        severity: "medium",
        message: `Amount ${amount} exceeds confirmation threshold ${policy.confirmationThreshold}; human confirmation required`,
        details: { amount, threshold: policy.confirmationThreshold },
      });
    }

    // 排除自身幂等键的既有记录：重复校验同一意图时按"替换"而非"累加"计算
    const spent = await policy.store.sumSince(
      policy.scope,
      policy.timeProvider() - DAY_MS,
      deriveSpendKey(intent, parsed),
    );
    if (spent + amount > policy.dailyLimit) {
      concerns.push({
        id: "DAILY_LIMIT_EXCEEDED",
        severity: "high",
        message: `Amount ${amount} would push 24h rolling spend to ${spent + amount} (limit ${policy.dailyLimit})`,
        details: { spent, amount, dailyLimit: policy.dailyLimit },
      });
    }
  }

  let verdict: Verdict = "allow";
  for (const c of concerns) verdict = worstVerdict(verdict, verdictForSeverity(c.severity, policy.mode));
  return { gate: "limits", verdict, concerns };
}
