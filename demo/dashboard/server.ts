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
 */
import { createServer, IncomingMessage, ServerResponse } from "http";
import { existsSync, readFileSync, statSync, readdirSync } from "fs";
import { join, extname } from "path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { Firewall, TransactionIntent, TemplateNarrator } from "../../src";
import { DASHBOARD_POLICY, SCAM_PROGRAM, scenarioDefinitions } from "../../scripts/attack-scenarios";
import { confirmHttp, getLatestBlockhashRetry, sendRawTransactionRetry } from "../../scripts/tx-confirm";
import idl from "../../programs/firewall/target/idl/firewall.json";

const PORT = Number(process.env.PORT || 3000);
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8898";
const PUBLIC_DIR = join(__dirname, "public");
const PROGRAM_ID = new PublicKey((idl as any).address);

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

  // 注资：演示场景合计 ~0.11 SOL，余额不足时从 FAUCET_KEYPAIR 补 0.5
  if (process.env.FAUCET_KEYPAIR && existsSync(process.env.FAUCET_KEYPAIR)) {
    const bal = await connection.getBalance(wallet.publicKey);
    if (bal < 0.06 * LAMPORTS_PER_SOL) {
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
    }
  }

  const firewall = new Firewall(DASHBOARD_POLICY, { connection });
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
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`防火墙面板: http://127.0.0.1:${PORT}`);
    console.log(`RPC: ${RPC_URL}`);
    console.log(`钱包: ${wallet.publicKey.toBase58()}`);
    console.log(`静态目录: ${PUBLIC_DIR}${existsSync(PUBLIC_DIR) ? `（${readdirSync(PUBLIC_DIR).length} 文件）` : "（缺失!）"}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
