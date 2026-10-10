import { EffectReport } from "../effects/collector";

/**
 * 协议无关安全不变量引擎（Layer 2 判定核心）。
 *
 * 不解析协议语义,只检查对所有协议都成立的安全事实:
 *   I1 每资产净流出上界 —— 钱包的代币余额下降必须有声明信封(当前 API 无逐资产声明,
 *      任何代币净流出在无声明时记 UNDECLARED_TOKEN_OUTFLOW)
 *   I2 权限零突变 —— delegate 出现/更换、delegatedAmount 增加(Approve)、
 *      closeAuthority 变更、冻结状态变化 = 资金控制权变更,一律 high/critical
 *   I4 敏感指令(顶层 + 内层)—— CPI 深层转发的 Approve/SetAuthority/CloseAccount 命中
 *   C1 覆盖完整性 —— 响应截断/前态缺失 = CoverageGap,fail-closed,不得当作"无变化"
 */
export interface InvariantViolation {
  invariant: string;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  details?: Record<string, unknown>;
}

const SENSITIVE_TAG_NAME: Record<number, string> = {
  4: "Approve",
  6: "SetAuthority",
  9: "CloseAccount",
};

/**
 * 链上错误码 ↔ 不变量 ID 映射(P4 闭环,与 programs/firewall/src/invariants.rs 一致):
 * 链上 revert 的错误码经此表翻译成客户端不变量语言,同一攻击两端用同一 ID 说话。
 */
export const INVARIANT_ERROR_CODES: Record<number, string> = {
  6011: "I1",
  6012: "I2",
};

export function runInvariants(
  report: EffectReport,
  wallet?: string,
  strictTokenOutflow = false,
): InvariantViolation[] {
  const out: InvariantViolation[] = [];

  // I2:权限零突变(有方向性:授权=拦截,撤销=信息)
  for (const d of report.tokenDeltas) {
    if (d.approveDetected) {
      out.push({
        invariant: "I2",
        severity: "high",
        message: `Simulation reveals an approval on token account ${d.account} (mint ${d.mint}): delegate set/changed or delegated amount increased — delegated authority can drain the balance`,
        details: {
          account: d.account,
          mint: d.mint,
          preDelegate: d.pre?.delegate?.toBase58() ?? null,
          postDelegate: d.post?.delegate?.toBase58() ?? null,
          delegatedAmountDelta: (d.post?.delegatedAmount ?? 0n) - (d.pre?.delegatedAmount ?? 0n) + "",
        },
      });
    } else if (d.delegateRevoked) {
      out.push({
        invariant: "I2",
        severity: "low",
        message: `Delegate revoked on token account ${d.account} — security cleanup, informational`,
        details: { account: d.account },
      });
    }
    if (d.closeAuthorityChanged) {
      out.push({
        invariant: "I2",
        severity: "high",
        message: `Simulation reveals closeAuthority change on token account ${d.account}`,
        details: { account: d.account },
      });
    }
    if (d.frozenChanged) {
      out.push({
        invariant: "I2",
        severity: "medium",
        message: `Token account ${d.account} freeze state changed in simulation`,
        details: { account: d.account },
      });
    }
  }

  // I1:代币净流出(钱包所有)
  // 审计响应:默认 strict 会否认一切代币业务(swap 必然代币流出)。
  // strictTokenOutflow=false → medium(escalate 人工确认);true → high(deny)。
  const walletOutflows = report.tokenDeltas.filter(
    (d) => d.amountDelta < 0n && (!wallet || d.owner === wallet),
  );
  if (walletOutflows.length > 0) {
    out.push({
      invariant: "I1",
      severity: strictTokenOutflow ? "high" : "medium",
      message: `Simulation reveals token outflows with no per-asset declaration: ${walletOutflows
        .map((d) => `${d.mint.slice(0, 8)}… -${d.amountDelta}`)
        .join(", ")} — token value leaves the wallet beyond the declared envelope`,
      details: { outflows: walletOutflows.map((d) => ({ mint: d.mint, account: d.account, delta: d.amountDelta + "" })) },
    });
  }

  // I4:内层敏感指令
  for (const hit of report.innerSensitiveHits) {
    out.push({
      invariant: "I4",
      severity: "high",
      message: `Inner instruction executes sensitive token op ${SENSITIVE_TAG_NAME[hit.tag] ?? hit.tag} via ${hit.program.slice(0, 12)}… — hidden from top-level static analysis`,
      details: { tag: hit.tag, program: hit.program },
    });
  }

  // C1:覆盖完整性(fail-closed)
  if (report.completeness === "truncated") {
    out.push({
      invariant: "C1",
      severity: "high",
      message: "Simulation response returned fewer accounts than requested — effects are incomplete and cannot be trusted",
    });
  } else if (report.completeness === "missing-pre") {
    out.push({
      invariant: "C1",
      severity: "medium",
      message: "Pre-state for some accounts could not be fetched (multi-node lag) — deltas may be unreliable",
    });
  }

  return out;
}
