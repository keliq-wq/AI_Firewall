import { Firewall } from "./validate";
import { FirewallPolicy, TransactionIntent, ValidationResult } from "./types";

/**
 * solana-agent-kit 插件适配器（.use() 链式扩展模式）。
 *
 * 通过结构性类型适配，不硬依赖 solana-agent-kit（peerDependency 可选）；
 * 若目标 Agent Kit 版本的扩展签名不同，仅需修改本适配器，防火墙核心不受影响。
 *
 * 用法（与 solana-agent-kit 扩展模式一致）：
 * ```ts
 * const agent = new SolanaAgentKit(privateKey, rpcUrl)
 *   .use(FirewallPlugin({ maxTransactionAmount: 100 }));
 *
 * const result = await agent.methods.validateTransaction({
 *   action: "transfer",
 *   amount: 50,
 *   recipient: "9WzDX...",
 *   purpose: "Payment for NFT purchase",
 * });
 * if (result.shouldProceed) {
 *   // 安全，执行交易
 * } else {
 *   console.log("Blocked:", result.concerns);
 * }
 * ```
 */

/** Agent Kit 的最小结构性接口（不硬依赖具体版本） */
export interface AgentKitLike {
  methods: Record<string, (...args: unknown[]) => unknown>;
}

/** 插件扩展函数：接收 agent 实例，挂载防火墙方法后原样返回 */
export type FirewallPluginExtension = (agent: AgentKitLike) => AgentKitLike;

export function FirewallPlugin(policyOptions: Partial<FirewallPolicy> = {}): FirewallPluginExtension {
  const firewall = new Firewall(policyOptions);
  return (agent: AgentKitLike) => {
    agent.methods.validateTransaction = (intent: unknown): Promise<ValidationResult> =>
      firewall.validateTransaction(intent as TransactionIntent);
    agent.methods.getFirewallPolicy = () => firewall.policy;
    agent.methods.getFirewallStats = () => firewall.stats;
    return agent;
  };
}
