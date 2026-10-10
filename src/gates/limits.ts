import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { transactionFingerprint } from "../accounting";
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
 * 滚动支出记账键 = 交易内容指纹(见 src/accounting.ts)。
 * 同笔交易重试 → 同指纹 → 幂等替换;不同交易(即使同收款方)→ 不同指纹 → 累积。
 * 修复审计发现的「同收款方 key 覆盖不累积」与「缺 recipient 塌缩」两路绕过。
 */
export function deriveSpendKey(intent: TransactionIntent, parsed: ParsedTransaction): string {
  return transactionFingerprint(intent, parsed);
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

    // 24h 支出 = 窗口内全部条目之和(指纹键保证同笔替换、异笔累积);
    // 排除自身指纹:已记录的同一意图重新校验时按"替换"而非"累加"判定
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
