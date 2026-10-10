import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** MCP 服务器 stdio 冒烟测试：真实拉起子进程走一遍 MCP 协议 */
describe("MCP 服务器（stdio 冒烟测试）", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [require.resolve("tsx/cli"), resolve(__dirname, "../src/mcp/server.ts")],
      cwd: resolve(__dirname, ".."),
      env: process.env as Record<string, string>,
    });
    client = new Client({ name: "firewall-test", version: "1.0.0" });
    await client.connect(transport);
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  it("工具列表包含三个防火墙工具", async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("validate_transaction");
    expect(names).toContain("explain_decision");
    expect(names).toContain("get_policy");
  });

  it("validate_transaction 拦截无 purpose 的转账(交易必传)", async () => {
    const wallet = Keypair.generate();
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 50 * LAMPORTS_PER_SOL,
      }),
    );
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = "1".repeat(32); // 测试用占位(32 字节零值的 base58)
    const res = await client.callTool({
      name: "validate_transaction",
      arguments: {
        action: "transfer",
        amount: 50,
        wallet: wallet.publicKey.toBase58(),
        transactionBase64: Buffer.from(tx.serialize({ verifySignatures: false })).toString("base64"),
      },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? "";
    const parsed = JSON.parse(text) as {
      shouldProceed: boolean;
      concerns: { id: string }[];
    };
    expect(parsed.shouldProceed).toBe(false);
    expect(parsed.concerns.some((c) => c.id === "PURPOSE_REQUIRED")).toBe(true);
  });

  it("explain_decision 返回中文叙述", async () => {
    const res = await client.callTool({
      name: "explain_decision",
      arguments: { action: "transfer", amount: 250, purpose: "rebalance" },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(text).toContain("已拦截");
    expect(text).toContain("transfer");
  });

  it("get_policy 返回生效策略", async () => {
    const res = await client.callTool({ name: "get_policy", arguments: {} });
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? "";
    const parsed = JSON.parse(text) as { mode: string; maxTransactionAmount: number };
    expect(parsed.mode).toBe("strict");
    expect(parsed.maxTransactionAmount).toBe(100);
  });
});
