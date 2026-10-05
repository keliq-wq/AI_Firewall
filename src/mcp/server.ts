#!/usr/bin/env node
/**
 * AI Agent 交易防火墙 — MCP 服务器（stdio）。
 *
 * 让任意 AI 助手（Claude / Cursor / 其他 MCP 客户端）在链上操作前调用防火墙：
 * - validate_transaction：CLAW 四门 +（配置 RPC 时）模拟执行验证
 * - explain_decision：自然语言风险叙述（默认离线模板；配置 LLM 环境变量后调用 LLM）
 * - get_policy：查看当前生效策略
 *
 * 环境变量：
 * - SOLANA_RPC_URL       可选：配置后启用第 2 层模拟执行
 * - FIREWALL_MODE        可选：strict（默认）/ monitor
 * - FIREWALL_MAX_TX_AMOUNT / FIREWALL_DAILY_LIMIT  可选：覆盖默认限额
 * - LLM_API_KEY / LLM_BASE_URL / LLM_MODEL          可选：启用 LLM 叙述（OpenAI 兼容端点）
 *
 * Claude Desktop 配置示例：
 * {
 *   "mcpServers": {
 *     "solana-firewall": {
 *       "command": "npx",
 *       "args": ["-y", "tsx", "D:/AI_Firewall/src/mcp/server.ts"],
 *       "env": { "SOLANA_RPC_URL": "https://api.mainnet-beta.solana.com" }
 *     }
 *   }
 * }
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
import { z } from "zod";
import { Narrator, OpenAICompatibleNarrator, TemplateNarrator } from "../narrator";
import { FirewallPolicy, TransactionIntent } from "../types";
import { Firewall } from "../validate";

function buildFirewall(): Firewall {
  const policy: Partial<FirewallPolicy> = {};
  if (process.env.FIREWALL_MODE === "strict" || process.env.FIREWALL_MODE === "monitor") {
    policy.mode = process.env.FIREWALL_MODE;
  }
  if (process.env.FIREWALL_MAX_TX_AMOUNT) {
    policy.maxTransactionAmount = Number(process.env.FIREWALL_MAX_TX_AMOUNT);
  }
  if (process.env.FIREWALL_DAILY_LIMIT) {
    policy.dailyLimit = Number(process.env.FIREWALL_DAILY_LIMIT);
  }
  const connection = process.env.SOLANA_RPC_URL
    ? new Connection(process.env.SOLANA_RPC_URL, "confirmed")
    : undefined;
  const narrator: Narrator = process.env.LLM_API_KEY
    ? new OpenAICompatibleNarrator({
        apiKey: process.env.LLM_API_KEY,
        baseURL: process.env.LLM_BASE_URL,
        model: process.env.LLM_MODEL,
      })
    : new TemplateNarrator();
  return new Firewall(policy, { connection, narrator });
}

/** base64 序列化交易 → Transaction / VersionedTransaction（按版本字节区分） */
function decodeTransaction(encoded: string): Transaction | VersionedTransaction {
  const buffer = Buffer.from(encoded, "base64");
  const first = buffer[0];
  return first !== undefined && (first & 0x80) !== 0
    ? VersionedTransaction.deserialize(buffer)
    : Transaction.from(buffer);
}

const INTENT_SCHEMA = {
  action: z.string().describe('Operation category, e.g. "transfer" | "swap" | "approve"'),
  amount: z.number().optional().describe("Amount in policy amountUnit (default SOL)"),
  recipient: z.string().optional().describe("Recipient address"),
  purpose: z.string().optional().describe("Business reason for sensitive actions"),
  wallet: z.string().optional().describe("Agent wallet address (enables simulation drain verification)"),
  idempotencyKey: z.string().optional().describe("Deduplicates 24h rolling-spend accounting"),
  programIds: z.array(z.string()).optional().describe("Programs involved in the transaction"),
  transactionBase64: z.string().optional().describe("Base64-serialized raw transaction (enables deep parse + simulation)"),
};

function intentFrom(args: z.infer<z.ZodObject<typeof INTENT_SCHEMA>>): TransactionIntent {
  const intent: TransactionIntent = {
    action: args.action,
    amount: args.amount,
    recipient: args.recipient,
    purpose: args.purpose,
    wallet: args.wallet,
    idempotencyKey: args.idempotencyKey,
    programIds: args.programIds,
  };
  if (args.transactionBase64) {
    intent.transaction = decodeTransaction(args.transactionBase64);
  }
  return intent;
}

async function main(): Promise<void> {
  const firewall = buildFirewall();
  const server = new McpServer({ name: "solana-firewall", version: "0.1.0" });

  server.registerTool(
    "validate_transaction",
    {
      title: "Validate transaction intent",
      description:
        "Run the firewall (CLAW four gates + optional simulation) on a transaction intent BEFORE signing. Returns per-gate verdicts, ranked concerns and a natural-language summary. Do not execute the transaction if shouldProceed is false.",
      inputSchema: INTENT_SCHEMA,
    },
    async (args) => {
      const intent = intentFrom(args);
      const result = await firewall.validateTransaction(intent);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    "explain_decision",
    {
      title: "Explain firewall decision",
      description:
        "Generate a human-readable (Chinese) narrative explaining the firewall verdict: what the transaction does, what was blocked, and why.",
      inputSchema: {
        action: z.string(),
        amount: z.number().optional(),
        recipient: z.string().optional(),
        purpose: z.string().optional(),
        wallet: z.string().optional(),
        idempotencyKey: z.string().optional(),
      },
    },
    async (args) => {
      const intent: TransactionIntent = {
        action: args.action,
        amount: args.amount,
        recipient: args.recipient,
        purpose: args.purpose,
        wallet: args.wallet,
        idempotencyKey: args.idempotencyKey,
      };
      const result = await firewall.validateTransaction(intent);
      const narrative = await firewall.explain(intent, result);
      return { content: [{ type: "text", text: narrative }] };
    },
  );

  server.registerTool(
    "get_policy",
    {
      title: "Get firewall policy",
      description: "Return the currently active firewall policy (limits, allow/deny lists, mode).",
      inputSchema: {},
    },
    async () => {
      return { content: [{ type: "text", text: JSON.stringify(firewall.policy, null, 2) }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[solana-firewall] MCP server ready (stdio)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
