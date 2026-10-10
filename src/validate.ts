import { Connection, LAMPORTS_PER_SOL, VersionedTransaction } from "@solana/web3.js";
import { avoidanceGate } from "./gates/avoidance";
import { credibilityGate } from "./gates/credibility";
import { envelopeGate } from "./gates/envelope";
import { deriveSpendKey, limitsGate, parseAmount } from "./gates/limits";
import { simulationGate } from "./gates/simulation";
import { worthGate } from "./gates/worth";
import { SEVERITY_RANK, verdictForSeverity, worstVerdict } from "./gates/util";
import { EffectsCollector } from "./effects/collector";
import { runInvariants } from "./invariants/engine";
import { Narrator, TemplateNarrator } from "./narrator";
import { ParsedTransaction, parseTransaction } from "./parser";
import { ResolvedPolicy, resolvePolicy } from "./policy";
import { TransactionSimulator } from "./rpc/simulator";
import { Concern, FirewallPolicy, GateDecision, TransactionIntent, ValidationResult, Verdict } from "./types";

export interface FirewallOptions {
  /** RPC 连接：配置后启用第 2 层（simulation 门），对原始交易执行模拟验证 */
  connection?: Connection;
  /** 风险叙述器：默认 TemplateNarrator（离线模板），可替换为 LLM 实现 */
  narrator?: Narrator;
}

/**
 * AI Agent 交易防火墙。
 *
 * 第 1 层（客户端快速拒绝）：CLAW 四门流水线 credibility → limits → avoidance → worth，
 * 离线零延迟，不依赖 RPC，同步解析 legacy/V0 交易。
 *
 * 第 2 层（模拟执行验证）：配置 connection 且传入原始交易时追加 simulation 门——
 * CPI 层 owner 变更检测 + 钱包净流出与声明金额比对。
 *
 * default-deny：strict 模式违规即 deny；monitor 模式降级为 escalate（需人工确认）。
 */
export class Firewall {
  readonly policy: ResolvedPolicy;
  private readonly simulator?: TransactionSimulator;
  private readonly connection?: Connection;
  private readonly narrator: Narrator;

  constructor(policy: Partial<FirewallPolicy> = {}, options: FirewallOptions = {}) {
    this.policy = resolvePolicy(policy);
    this.simulator = options.connection ? new TransactionSimulator(options.connection) : undefined;
    this.connection = options.connection;
    this.narrator = options.narrator ?? new TemplateNarrator();
  }

  /** 验证一笔交易意图。放行时（且声明了金额）将金额计入 24h 滚动支出。 */
  async validateTransaction(intent: TransactionIntent): Promise<ValidationResult> {
    const parsed = parseTransaction(intent.transaction);
    const decisions: GateDecision[] = [
      credibilityGate(intent, parsed, this.policy),
      await limitsGate(intent, parsed, this.policy),
      envelopeGate(intent, parsed, this.policy),
      avoidanceGate(intent, parsed, this.policy),
      worthGate(intent, parsed, this.policy),
    ];

    // 第 2 层：配置了 RPC 连接且传入原始交易时，追加模拟执行验证
    if (this.simulator && intent.transaction) {
      decisions.push(await simulationGate(intent, intent.transaction, this.simulator, this.policy));

      // 不变量引擎(V0 专属):效果收集器提取代币余额/权限突变事实,
      // 协议无关不变量 I1/I2/I4/C1 判定。legacy 无 CPI 可见性,保持旧路径。
      if (this.connection && intent.transaction instanceof VersionedTransaction) {
        decisions.push(await this.invariantsGate(intent));
      }
    }

    let overall: Verdict = "allow";
    for (const d of decisions) overall = worstVerdict(overall, d.verdict);

    if (overall === "allow") {
      await this.recordSpend(intent, parsed);
    }

    const concerns = decisions
      .flatMap((d) => d.concerns)
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

    return {
      shouldProceed: overall === "allow",
      requiresConfirmation: overall === "escalate",
      decisions,
      concerns,
      summary: buildSummary(decisions, overall),
    };
  }

  /** 不变量引擎:效果收集 → 协议无关不变量(I1/I2/I4/C1)→ 门判定 */
  private async invariantsGate(intent: TransactionIntent): Promise<GateDecision> {
    const report = await new EffectsCollector(this.connection!).collect(intent.transaction!);
    const violations = runInvariants(report, intent.wallet);
    const concerns: Concern[] = violations.map((v) => ({
      id: `INV_${v.invariant}`,
      severity: v.severity,
      message: v.message,
      details: v.details,
    }));
    let verdict: Verdict = "allow";
    for (const c of concerns) verdict = worstVerdict(verdict, verdictForSeverity(c.severity, this.policy.mode));
    return { gate: "invariants", verdict, concerns };
  }

  /** 生成面向人类/Agent 的自然语言风险叙述 */
  async explain(intent: TransactionIntent, result: ValidationResult): Promise<string> {
    return this.narrator.explain(intent, result);
  }

  private async recordSpend(intent: TransactionIntent, parsed: ParsedTransaction): Promise<void> {
    // 修复「不声明金额永不记账」:声明缺失时用解析出的真实转出额兜底
    let amount = parseAmount(intent.amount);
    if (amount == null) {
      const lamports = parsed.nativeTransfers.reduce((sum, t) => sum + t.lamports, 0);
      if (lamports > 0) {
        amount = lamports / (this.policy.amountUnit === "sol" ? LAMPORTS_PER_SOL : 1);
      }
    }
    if (amount == null) return; // 确实无资金移动(代币部分由 Layer 2 处理)
    await this.policy.store.record(
      this.policy.scope,
      deriveSpendKey(intent, parsed),
      amount,
      this.policy.timeProvider(),
    );
  }
}

/** 函数式入口 */
export function validateTransaction(
  intent: TransactionIntent,
  policy: Partial<FirewallPolicy> = {},
): Promise<ValidationResult> {
  return new Firewall(policy).validateTransaction(intent);
}

function buildSummary(decisions: GateDecision[], overall: Verdict): string {
  if (overall === "allow") {
    const gates = decisions.map((d) => d.gate).join("/");
    return `All ${decisions.length} gates passed (${gates}).`;
  }
  const denied = decisions.filter((d) => d.verdict === "deny").map((d) => d.gate);
  const escalated = decisions.filter((d) => d.verdict === "escalate").map((d) => d.gate);
  const parts: string[] = [];
  if (denied.length > 0) parts.push(`denied by: ${denied.join(", ")}`);
  if (escalated.length > 0) parts.push(`escalated for human confirmation: ${escalated.join(", ")}`);
  return parts.join("; ") + ".";
}
