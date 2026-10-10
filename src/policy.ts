import { InMemorySpendStore } from "./store";
import { FirewallPolicy, SpendStore } from "./types";

/** 全部字段已解析（含默认值）的策略 */
export interface ResolvedPolicy {
  mode: "strict" | "monitor";
  maxTransactionAmount: number;
  confirmationThreshold: number;
  dailyLimit: number;
  amountUnit: "sol" | "lamports";
  allowedPrograms: string[];
  blockedPrograms: string[];
  blockedAddresses: string[];
  requirePurposeFor: string[];
  requirePurposeAbove: number;
  scope: string;
  simulationFeeTolerance: number;
  strictTokenOutflow: boolean;
  store: SpendStore;
  timeProvider: () => number;
}

/**
 * 内置默认策略（与 Sentinel Safety Plugin 对齐）：
 * 单笔上限 100、确认阈值 10、六类敏感操作（transfer/swap/approve/bridge/withdraw/stake）需 purpose。
 */
export function resolvePolicy(overrides: Partial<FirewallPolicy> = {}): ResolvedPolicy {
  return {
    mode: overrides.mode ?? "strict",
    maxTransactionAmount: overrides.maxTransactionAmount ?? 100,
    confirmationThreshold: overrides.confirmationThreshold ?? 10,
    dailyLimit: overrides.dailyLimit ?? 500,
    amountUnit: overrides.amountUnit ?? "sol",
    allowedPrograms: overrides.allowedPrograms ?? [],
    blockedPrograms: overrides.blockedPrograms ?? [],
    blockedAddresses: overrides.blockedAddresses ?? [],
    requirePurposeFor:
      overrides.requirePurposeFor ?? ["transfer", "swap", "approve", "bridge", "withdraw", "stake"],
    requirePurposeAbove: overrides.requirePurposeAbove ?? Number.POSITIVE_INFINITY,
    scope: overrides.scope ?? "default",
    simulationFeeTolerance: overrides.simulationFeeTolerance ?? 0.05,
    strictTokenOutflow: overrides.strictTokenOutflow ?? false,
    store: overrides.store ?? new InMemorySpendStore(),
    timeProvider: overrides.timeProvider ?? (() => Date.now()),
  };
}
