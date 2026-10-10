/**
 * 验收测试来源：探针 scripts/__refuter-mcp-claims-probe.tmp.ts（写于 2026-10-10，早于当日 P1 修复）。
 *
 * 反转（依据 81ba8d2 “mandatory transaction”）：MCP 边界上 transactionBase64 现为必传字段——
 * 探针 A 的“无交易自述塌缩”在 MCP 路径已关闭（缺字段直接被 zod 校验拒绝）；直连 API 层残留
 * 缺口未写入本测试，按流程记入 backlog。同时校验 P3 字段（38dbf58：tier / fingerprint）
 * 经 MCP 响应透出。
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("MCP 边界 — transactionBase64 必传（探针 A 路径关闭）", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [require.resolve("tsx/cli"), resolve(__dirname, "../src/mcp/server.ts")],
      cwd: resolve(__dirname, ".."),
      env: process.env as Record<string, string>,
    });
    client = new Client({ name: "firewall-mandatory-tx-test", version: "1.0.0" });
    await client.connect(transport);
  }, 30000);

  afterAll(async () => {
    await client.close();
  });

  it("缺 transactionBase64 → 工具返回输入校验错误（无交易不再可校验）", async () => {
    const res = await client.callTool({
      name: "validate_transaction",
      arguments: { action: "transfer", amount: 1, purpose: "x" },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(text).toMatch(/Input validation|transactionBase64/i);
  });

  it("带 transactionBase64 → 正常放行且响应含 tier / fingerprint（P3 字段）", async () => {
    const wallet = Keypair.generate();
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 0.01 * LAMPORTS_PER_SOL,
      }),
    );
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = "1".repeat(32);

    const res = await client.callTool({
      name: "validate_transaction",
      arguments: {
        action: "transfer",
        amount: 0.01,
        purpose: "pay invoice",
        wallet: wallet.publicKey.toBase58(),
        transactionBase64: Buffer.from(tx.serialize({ verifySignatures: false })).toString("base64"),
      },
    });
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? "";
    const parsed = JSON.parse(text) as {
      shouldProceed: boolean;
      tier: string;
      fingerprint: string | null;
      decisions: { gate: string }[];
    };

    expect(parsed.shouldProceed).toBe(true);
    expect(parsed.tier).toBe("info");
    expect(parsed.fingerprint).not.toBeNull();
    expect(parsed.decisions.map((d) => d.gate)).toEqual([
      "credibility",
      "limits",
      "envelope",
      "avoidance",
      "worth",
    ]);
  });
});
