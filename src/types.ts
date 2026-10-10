import type { Transaction, VersionedTransaction } from "@solana/web3.js";

/** 单门判定：allow 放行 / deny 拦截 / escalate 升级人工确认 */
export type Verdict = "allow" | "deny" | "escalate";

/**
 * CLAW 四门协议（参考 GuardianClaw 的设计）：
 * - credibility 可信度：程序白名单 + Solana 特有 owner 变更检测
 * - limits      限额：单笔上限、确认阈值、24h 滚动支出
 * - avoidance   规避：程序/地址黑名单（命中即 deny，优先级最高）
 * - worth       意图价值：敏感操作必须提供业务理由（purpose）
 * 第 2 层（配置 RPC 连接后）追加：
 * - simulation  模拟执行：simulateTransaction 揭示 CPI 层 owner 变更与钱包净流出比对
 */
export type GateName = "credibility" | "limits" | "envelope" | "avoidance" | "worth" | "simulation" | "invariants";

export type Severity = "low" | "medium" | "high" | "critical";

/** 单条风险发现：id 稳定可审计，details 供日志/审计使用 */
export interface Concern {
  id: string;
  severity: Severity;
  message: string;
  details?: Record<string, unknown>;
}

export interface GateDecision {
  gate: GateName;
  verdict: Verdict;
  concerns: Concern[];
}

/** Agent 意图的高层描述。transaction 可选：提供时执行离线深度解析（owner 变更 / 转账明细）。 */
export interface TransactionIntent {
  /** 操作类别："transfer" | "swap" | "approve" | "bridge" | "withdraw" | "stake" 或自定义 */
  action: string;
  /** 金额，policy.amountUnit 单位（默认 SOL）。也接受数字字符串 */
  amount?: number | string;
  /** 收款方地址 */
  recipient?: string;
  /** 涉及的链上程序；未提供时从 transaction 解析 */
  programIds?: string[];
  /** 敏感操作的业务理由（worth 门要求） */
  purpose?: string;
  /** 幂等键：同一意图重复校验时，24h 滚动支出不重复计入 */
  idempotencyKey?: string;
  /** Agent 钱包地址：第 2 层模拟执行据此比对净流出与声明金额 */
  wallet?: string;
  /** 原始交易对象（legacy 或 versioned），执行离线深度解析 */
  transaction?: Transaction | VersionedTransaction;
}

/** 策略配置。未设置的字段使用内置默认值。 */
export interface FirewallPolicy {
  /** strict：违规直接 deny；monitor：违规降级为 escalate（需人工确认）。默认 strict */
  mode?: "strict" | "monitor";
  /** 单笔交易金额上限（amountUnit 单位） */
  maxTransactionAmount?: number;
  /** 超过此金额需人工确认（escalate） */
  confirmationThreshold?: number;
  /** 24h 滚动支出上限（amountUnit 单位） */
  dailyLimit?: number;
  /** 金额单位。默认 "sol" */
  amountUnit?: "sol" | "lamports";
  /** 程序白名单：非空时，交易涉及的所有程序必须命中，否则 deny */
  allowedPrograms?: string[];
  /** 程序黑名单：命中即 deny */
  blockedPrograms?: string[];
  /** 地址黑名单：收款方或交易账户命中即 deny */
  blockedAddresses?: string[];
  /** 必须提供 purpose 的敏感操作列表 */
  requirePurposeFor?: string[];
  /** 金额超过该值也必须提供 purpose。默认不启用 */
  requirePurposeAbove?: number;
  /** 滚动支出记账的命名空间（区分不同 Agent/钱包）。默认 "default" */
  scope?: string;
  /** 第 2 层模拟执行：允许实际流出超出声明金额的容差（amountUnit 单位，覆盖手续费）。默认 0.05 */
  simulationFeeTolerance?: number;
  /** 滚动支出存储（默认内存实现；生产环境可替换为 Redis/DB） */
  store?: SpendStore;
  /** 时钟注入（测试用）。默认 Date.now */
  timeProvider?: () => number;
}

/** 升级分级(对治告警疲劳):info=仅记录;notice=提示;confirm=需人工确认;deny=拒绝 */
export type EscalationTier = "info" | "notice" | "confirm" | "deny";

export interface ValidationResult {
  /** 是否放行执行 */
  shouldProceed: boolean;
  /** 是否需要人工确认（存在 escalate 且无 deny） */
  requiresConfirmation: boolean;
  /** 升级分级:由最高严重度关切推导(low→info, medium→notice, high→confirm, critical→deny) */
  tier: EscalationTier;
  /** 交易内容指纹(有交易或幂等键时非空)——供 Agent 引用与审计追踪 */
  fingerprint: string | null;
  /** 四门逐项判定 */
  decisions: GateDecision[];
  /** 全部风险发现（扁平化，按严重度降序） */
  concerns: Concern[];
  /** 面向 Agent / 人的自然语言风险摘要 */
  summary: string;
}

/** 滚动支出存储抽象 */
export interface SpendStore {
  /** 记录一笔支出；同一 (scope, key) 重复记录视为幂等更新 */
  record(scope: string, key: string, amount: number, at?: number): void | Promise<void>;
  /**
   * 返回 scope 自 since（epoch ms）以来的支出总和。
   * excludeKey 用于幂等校验：同一意图重复校验时排除自身已记录的条目。
   */
  sumSince(scope: string, since: number, excludeKey?: string): number | Promise<number>;
}
