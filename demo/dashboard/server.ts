/**
 * 防火墙可视化面板后端（零依赖，node:http + 静态文件 + JSON API）。
 *
 * 运行：
 *   RPC_URL=http://127.0.0.1:8898 WALLET_KEYPAIR=~/.config/solana/id.json \
 *   npx tsx demo/dashboard/server.ts          # 默认端口 3000
 *
 * 环境变量：
 *   RPC_URL        默认 http://127.0.0.1:8898（rpc-proxy → testnet；本地验证器用 http://127.0.0.1:8899）
 *   WALLET_KEYPAIR 演示钱包（缺省自动生成；无资金则场景 B/C 模拟会报余额不足）
 *   FAUCET_KEYPAIR 注资钱包（余额 < 0.06 SOL 时自动转 0.5 补充）
 *   PORT           默认 3000
 *   NO_OPEN=1      启动时不自动打开浏览器（无头环境/CI 用）
 *
 * API：
 *   POST /api/attack     剧本演示（点击剧本按钮）
 *   POST /api/validate   实时拦截入口：任意 Agent/MCP 客户端把交易 POST 过来，
 *                        判定实时写入日志并 SSE 推给面板（MCP 同款 base64 语义）
 *   GET  /api/events     SSE 实时拦截日志流（连接时先推历史 200 条，之后逐条推送）
 *   GET  /api/state      面板状态
 * 日志持久化：每条判定追加到 logs/events.jsonl（重启加载最近 300 条，目录已 gitignore）
 */
import { createServer, IncomingMessage, ServerResponse } from "http";
import { exec } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, readdirSync } from "fs";
import { join, extname } from "path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { DecisionEvent, Firewall, TransactionIntent, TemplateNarrator } from "../../src";
import { DASHBOARD_POLICY, SCAM_PROGRAM, scenarioDefinitions } from "../../scripts/attack-scenarios";
import { confirmHttp, getLatestBlockhashRetry, sendRawTransactionRetry } from "../../scripts/tx-confirm";
import idl from "../../programs/firewall/idl/firewall.json";

const PORT = Number(process.env.PORT || 3000);
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const PUBLIC_DIR = join(__dirname, "public");
const PROGRAM_ID = new PublicKey((idl as any).address);
const LOG_DIR = join(__dirname, "logs");
const LOG_FILE = join(LOG_DIR, "events.jsonl");
const LOG_MAX = 500;

/** base64 序列化交易 → Transaction / VersionedTransaction（按首字节高位区分，与 MCP 同语义） */
function decodeTransaction(encoded: string): Transaction | VersionedTransaction {
  const buffer = Buffer.from(encoded, "base64");
  const first = buffer[0];
  return first !== undefined && (first & 0x80) !== 0
    ? VersionedTransaction.deserialize(buffer)
    : Transaction.from(buffer);
}

function loadKp(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf-8")) as number[]));
}

interface EventRecord {
  id: string;
  time: number;
  scenarioId: string;
  icon: string;
  title: string;
  titleEn: string;
  verdict: string;
  requiresConfirmation: boolean;
  summary: string;
  narration: string;
  narrationEn: string;
  concerns: { id: string; severity: string; message: string }[];
}

async function main(): Promise<void> {
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = process.env.WALLET_KEYPAIR ? loadKp(process.env.WALLET_KEYPAIR) : Keypair.generate();

  // 注资：演示场景合计 ~0.11 SOL，余额不足时优先从 FAUCET_KEYPAIR 补 0.5；
  // 否则尝试 devnet 水龙头(requestAirdrop,devnet/本地验证器可用,mainnet 静默失败)
  const walletBal = await connection.getBalance(wallet.publicKey);
  if (walletBal < 0.06 * LAMPORTS_PER_SOL) {
    if (process.env.FAUCET_KEYPAIR && existsSync(process.env.FAUCET_KEYPAIR)) {
      const faucet = loadKp(process.env.FAUCET_KEYPAIR);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: faucet.publicKey,
          toPubkey: wallet.publicKey,
          lamports: 0.5 * LAMPORTS_PER_SOL,
        }),
      );
      tx.feePayer = faucet.publicKey;
      tx.recentBlockhash = (await getLatestBlockhashRetry(connection)).blockhash;
      tx.sign(faucet);
      const sig = await sendRawTransactionRetry(connection, tx);
      const r = await confirmHttp(connection, sig);
      if (!r.err) console.log(`已为演示钱包注资 0.5 SOL（${wallet.publicKey.toBase58()}）`);
    } else {
      try {
        const sig = await connection.requestAirdrop(wallet.publicKey, 0.5 * LAMPORTS_PER_SOL);
        await confirmHttp(connection, sig);
        console.log(`已通过水龙头为演示钱包注资 0.5 SOL（${wallet.publicKey.toBase58()}）`);
      } catch {
        console.log("演示钱包余额不足且水龙头不可用——攻击剧本 B/C 的模拟会报余额不足,属预期行为");
      }
    }
  }

  // 实时拦截日志：内存 + JSONL 持久化（重启加载最近 300 条）+ SSE 订阅者
  const logEvents: DecisionEvent[] = [];
  mkdirSync(LOG_DIR, { recursive: true });
  if (existsSync(LOG_FILE)) {
    for (const line of readFileSync(LOG_FILE, "utf-8").trim().split("\n").slice(-300)) {
      try {
        logEvents.push(JSON.parse(line));
      } catch {
        // 跳过损坏行
      }
    }
  }
  logEvents.reverse(); // JSONL 为旧→新追加序，内存保持新在前
  const sseClients = new Set<ServerResponse>();

  const firewall = new Firewall(DASHBOARD_POLICY, {
    connection,
    onDecision: (ev) => {
      logEvents.unshift(ev);
      if (logEvents.length > LOG_MAX) logEvents.pop();
      try {
        appendFileSync(LOG_FILE, JSON.stringify(ev) + "\n");
      } catch {
        // 磁盘写入失败不影响面板
      }
      const payload = `data: ${JSON.stringify(ev)}\n\n`;
      for (const client of sseClients) {
        try {
          client.write(payload);
        } catch {
          sseClients.delete(client);
        }
      }
    },
  });
  const scenarios = scenarioDefinitions({ connection, wallet: wallet.publicKey });
  const events: EventRecord[] = [];
  const spent: { time: number; amount: number }[] = [];

  async function runScenario(id: string): Promise<EventRecord> {
    const scenario = scenarios.find((s) => s.id === id);
    if (!scenario) throw new Error(`未知剧本: ${id}`);
    const { intent } = await scenario.build({ connection, wallet: wallet.publicKey });
    const result = await firewall.validateTransaction(intent);
    const narration = await new TemplateNarrator("zh").explain(intent, result);
    const narrationEn = await new TemplateNarrator("en").explain(intent, result);

    // 放行的金额计入 24h 滚动支出（面板展示用）
    if (result.shouldProceed) {
      const amt = typeof intent.amount === "number" ? intent.amount : parseFloat(intent.amount || "0") || 0;
      if (amt > 0) spent.push({ time: Date.now(), amount: amt });
    }

    const record: EventRecord = {
      id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      time: Date.now(),
      scenarioId: scenario.id,
      icon: scenario.icon,
      title: scenario.title,
      titleEn: scenario.titleEn,
      verdict: result.shouldProceed ? "allow" : result.requiresConfirmation ? "escalate" : "deny",
      requiresConfirmation: result.requiresConfirmation,
      summary: result.summary,
      narration,
      narrationEn,
      concerns: result.concerns.slice(0, 5).map((c) => ({
        id: c.id,
        severity: c.severity,
        message: c.message,
      })),
    };
    events.unshift(record);
    if (events.length > 200) events.pop();
    return record;
  }

  async function buildState() {
    const DAY = 24 * 3600 * 1000;
    const now = Date.now();
    const spent24h = spent.filter((s) => now - s.time < DAY).reduce((sum, s) => sum + s.amount, 0);
    const [walletBal, programAccount, vaultBal] = await Promise.all([
      connection.getBalance(wallet.publicKey),
      connection.getAccountInfo(PROGRAM_ID),
      (async () => {
        try {
          const [vaultPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), wallet.publicKey.toBuffer()],
            PROGRAM_ID,
          );
          return await connection.getBalance(vaultPda);
        } catch {
          return null;
        }
      })(),
    ]);
    return {
      rpcUrl: RPC_URL,
      wallet: wallet.publicKey.toBase58(),
      walletBalance: walletBal / LAMPORTS_PER_SOL,
      policy: {
        mode: DASHBOARD_POLICY.mode,
        maxTransactionAmount: DASHBOARD_POLICY.maxTransactionAmount,
        dailyLimit: DASHBOARD_POLICY.dailyLimit,
        allowedPrograms: DASHBOARD_POLICY.allowedPrograms,
        blockedPrograms: DASHBOARD_POLICY.blockedPrograms,
      },
      spent24h,
      program: {
        id: PROGRAM_ID.toBase58(),
        executable: programAccount?.executable ?? false,
        vaultBalance: vaultBal != null ? vaultBal / LAMPORTS_PER_SOL : null,
      },
      scamProgram: SCAM_PROGRAM.toBase58(),
      events: events.slice(0, 50),
      logCount: logEvents.length,
    };
  }

  const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json",
  };

  function serveStatic(res: ServerResponse, path: string): void {
    const file = join(PUBLIC_DIR, path === "/" ? "index.html" : path);
    if (!file.startsWith(PUBLIC_DIR) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    try {
      if (url.pathname === "/api/attack" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { id } = JSON.parse(body || "{}");
        const record = await runScenario(id);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(record));
        return;
      }
      if (url.pathname === "/api/events") {
        // SSE 实时拦截日志流：连接时先推历史 200 条（init 消息），之后每条判定实时推送
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(`data: ${JSON.stringify({ init: true, events: logEvents.slice(0, 200) })}\n\n`);
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }
      if (url.pathname === "/api/validate" && req.method === "POST") {
        // 实时拦截入口：任意 Agent/MCP 客户端 POST 原始交易 → 防火墙判定 → 日志实时上屏
        let body = "";
        for await (const chunk of req) body += chunk;
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(body || "{}");
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid JSON body" }));
          return;
        }
        const { transactionBase64 } = args;
        if (typeof transactionBase64 !== "string" || transactionBase64.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "transactionBase64 is required (same semantics as the MCP tool)" }));
          return;
        }
        let transaction: Transaction | VersionedTransaction;
        try {
          transaction = decodeTransaction(transactionBase64);
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `cannot decode transaction: ${String(e)}` }));
          return;
        }
        const intent: TransactionIntent = {
          action: typeof args.action === "string" ? args.action : "external",
          amount:
            typeof args.amount === "number" || typeof args.amount === "string"
              ? (args.amount as number | string)
              : undefined,
          recipient: typeof args.recipient === "string" ? args.recipient : undefined,
          purpose: typeof args.purpose === "string" ? args.purpose : undefined,
          wallet: typeof args.wallet === "string" ? args.wallet : undefined,
          idempotencyKey: typeof args.idempotencyKey === "string" ? args.idempotencyKey : undefined,
        };
        intent.transaction = transaction;
        const result = await firewall.validateTransaction(intent);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            shouldProceed: result.shouldProceed,
            requiresConfirmation: result.requiresConfirmation,
            tier: result.tier,
            fingerprint: result.fingerprint,
            summary: result.summary,
            concerns: result.concerns.slice(0, 5),
          }),
        );
        return;
      }
      if (url.pathname === "/api/state") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(await buildState()));
        return;
      }
      if (url.pathname === "/api/scenarios") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify(
            scenarios.map((s) => ({
              id: s.id,
              icon: s.icon,
              title: s.title,
              titleEn: s.titleEn,
              description: s.description,
              descriptionEn: s.descriptionEn,
            })),
          ),
        );
        return;
      }
      serveStatic(res, url.pathname);
    } catch (e) {
      // 客户端可能已断开(刷新/取消),避免二次写头导致进程崩溃
      if (!res.headersSent && !res.destroyed) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      } else {
        res.destroy();
      }
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${PORT}`;
    console.log(`防火墙面板: ${url}`);
    console.log(`RPC: ${RPC_URL}`);
    console.log(`钱包: ${wallet.publicKey.toBase58()}`);
    console.log(`静态目录: ${PUBLIC_DIR}${existsSync(PUBLIC_DIR) ? `（${readdirSync(PUBLIC_DIR).length} 文件）` : "（缺失!）"}`);
    // 自动打开默认浏览器（无头/CI 环境设 NO_OPEN=1 关闭;失败静默,不影响面板）
    if (!process.env.NO_OPEN) {
      const open =
        process.platform === "win32" ? `start "" "${url}"`
        : process.platform === "darwin" ? `open "${url}"`
        : `xdg-open "${url}"`;
      exec(open, () => {});
      console.log(`已在默认浏览器打开面板 ${process.platform}`);
    }
  });

  // SSE 心跳：防止浏览器/中间代理空闲断连（unref 不阻塞进程退出）
  setInterval(() => {
    for (const client of sseClients) {
      try {
        client.write(": ping\n\n");
      } catch {
        sseClients.delete(client);
      }
    }
  }, 15000).unref();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
