import { LAMPORTS_PER_SOL, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { TransactionSimulator } from "../rpc/simulator";
import { ResolvedPolicy } from "../policy";
import { Concern, GateDecision, TransactionIntent, Verdict } from "../types";
import { verdictForSeverity, worstVerdict } from "./util";
import { parseAmount } from "./limits";

/**
 * Simulation 门（第 2 层）：模拟执行验证。
 *
 * 核心能力：
 * 1. CPI 层 owner 变更检测——静态解析（第 1 层）看不见内部指令，只有模拟执行能揭示，critical 一律 deny
 * 2. 钱包净流出与声明金额比对——超出声明 + 容差 → deny；未声明金额却有净流出 → deny
 * 3. 模拟失败（交易将 revert）→ escalate
 */
export async function simulationGate(
  intent: TransactionIntent,
  tx: Transaction | VersionedTransaction,
  simulator: TransactionSimulator,
  policy: ResolvedPolicy,
): Promise<GateDecision> {
  const concerns: Concern[] = [];
  // legacy 交易缺少 fee payer 时以 intent.wallet 回退（模拟需要可序列化的交易）
  const fallbackPayer = intent.wallet ? tryPublicKey(intent.wallet) : undefined;
  const report = await simulator.simulate(tx, fallbackPayer);

  if (report.err) {
    concerns.push({
      id: "SIMULATION_ERROR",
      severity: "medium",
      message: `Transaction fails simulation and would revert on-chain: ${report.err}`,
      details: { err: report.err },
    });
  }

  // CPI 层 owner 变更：第 1 层静态解析覆盖不到的深度攻击面
  for (const effect of report.effects) {
    if (effect.ownerChanged) {
      concerns.push({
        id: "OWNER_CHANGE_SIMULATED",
        severity: "critical",
        message: `Simulation reveals owner of ${effect.account} changes from ${effect.preOwner} to ${effect.postOwner} via inner instructions invisible to static analysis`,
        details: {
          account: effect.account,
          preOwner: effect.preOwner,
          postOwner: effect.postOwner,
        },
      });
    }
  }

  // 钱包净流出与声明金额比对
  const wallet = intent.wallet;
  if (!wallet) {
    concerns.push({
      id: "WALLET_UNDECLARED",
      severity: "low",
      message: "Declare intent.wallet to enable drain verification in the simulation gate",
    });
  } else {
    const outflow = report.effects
      .filter((e) => e.account === wallet)
      .reduce((sum, e) => sum + Math.max(0, -e.deltaLamports), 0);
    const declaredLamports =
      parseAmount(intent.amount) != null
        ? parseAmount(intent.amount)! * (policy.amountUnit === "sol" ? LAMPORTS_PER_SOL : 1)
        : null;
    const tolerance = policy.simulationFeeTolerance * (policy.amountUnit === "sol" ? LAMPORTS_PER_SOL : 1);

    if (outflow > 0) {
      if (declaredLamports != null) {
        if (outflow > declaredLamports + tolerance) {
          concerns.push({
            id: "UNEXPECTED_DRAIN",
            severity: "high",
            message: `Wallet ${wallet} drains ${outflow} lamports but only ${declaredLamports} were declared (tolerance ${tolerance})`,
            details: { wallet, outflow, declaredLamports, tolerance },
          });
        } else if (outflow !== declaredLamports) {
          concerns.push({
            id: "DRAIN_MISMATCH",
            severity: "low",
            message: `Actual outflow ${outflow} lamports vs declared ${declaredLamports} (within tolerance)`,
            details: { wallet, outflow, declaredLamports },
          });
        }
      } else if (outflow > tolerance) {
        concerns.push({
          id: "UNDECLARED_OUTFLOW",
          severity: "high",
          message: `Wallet ${wallet} drains ${outflow} lamports with no declared amount`,
          details: { wallet, outflow, tolerance },
        });
      }
    }
  }

  let verdict: Verdict = "allow";
  for (const c of concerns) verdict = worstVerdict(verdict, verdictForSeverity(c.severity, policy.mode));
  return { gate: "simulation", verdict, concerns };
}

function tryPublicKey(value: string): PublicKey | undefined {
  try {
    return new PublicKey(value);
  } catch {
    return undefined;
  }
}
