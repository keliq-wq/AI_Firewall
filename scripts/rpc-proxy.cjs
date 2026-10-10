/**
 * 本地 RPC 转发代理(HTTP + WebSocket):经 Clash(127.0.0.1:7890)转发到上游 Solana RPC。
 *
 * 用途:本机直连被墙的集群(testnet/mainnet/devnet 官方端点),而 node/web3.js 不吃系统代理。
 * 同时监听 HTTP 端口与 HTTP+1 端口(web3.js 按端口+1 推导 WebSocket 端点)。
 *
 * 用法:
 *   TARGET_URL=https://api.testnet.solana.com node scripts/rpc-proxy.cjs
 * 然后所有客户端把 RPC 地址写成 http://127.0.0.1:8898(默认 HTTP 端口)。
 */
const http = require("http");
const net = require("net");
const tls = require("tls");

const TARGET = process.env.TARGET_URL || "https://api.testnet.solana.com";
const PORT = Number(process.env.PORT || 8898);
const PROXY = process.env.UPSTREAM_PROXY || "http://127.0.0.1:7890";

const targetUrl = new URL(TARGET);
const proxyUrl = new URL(PROXY);

function handleRequest(req, res) {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers };
    delete headers["accept-encoding"];
    delete headers["proxy-connection"];
    headers["content-length"] = body.length;
    headers["host"] = targetUrl.host;

    const upstream = http.request(
      {
        host: proxyUrl.hostname,
        port: proxyUrl.port || 80,
        method: req.method,
        path: TARGET + req.url, // 绝对 URI = HTTP 正向代理语义
        headers,
      },
      (upRes) => {
        res.writeHead(upRes.statusCode || 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    upstream.on("error", (e) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "proxy error: " + e.message }, id: null }));
    });
    upstream.end(body);
  });
}

/** WebSocket 升级:CONNECT 打通 TCP 隧道 → TLS → 转发原始升级请求 */
function handleUpgrade(req, socket, head) {
  console.log(`[ws] upgrade: ${req.method} ${req.url} (${req.headers["user-agent"] || "?"})`);
  const connectReq = net.connect(Number(proxyUrl.port) || 80, proxyUrl.hostname, () => {
    connectReq.write(
      `CONNECT ${targetUrl.host}:443 HTTP/1.1\r\nHost: ${targetUrl.host}:443\r\nProxy-Connection: keep-alive\r\n\r\n`,
    );
  });

  let buf = Buffer.alloc(0);
  let upgraded = false;
  connectReq.on("data", (d) => {
    if (upgraded) return;
    buf = Buffer.concat([buf, d]);
    if (!buf.includes("\r\n\r\n")) return;
    const statusLine = buf.toString().split("\r\n")[0] || "";
    if (!statusLine.includes("200")) {
      socket.destroy();
      return;
    }
    upgraded = true;

    const tlsSocket = tls.connect({ socket: connectReq, servername: targetUrl.hostname }, () => {
      // 上游 pubsub 拒绝带 Origin 的握手(仅接受无 Origin);Host 必须指向上游域名(否则 403)
      const headers = { ...req.headers };
      delete headers["origin"];
      headers["host"] = targetUrl.host;
      const headerLines = Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n");
      tlsSocket.write(`${req.method} ${req.url} HTTP/1.1\r\n${headerLines}\r\n\r\n`);
      if (head.length) tlsSocket.write(head);
      console.log(`[ws] tunnel up, piping`);
      tlsSocket.on("data", (d) => console.log(`[ws] upstream→client ${d.length}B: ${d.toString("hex").slice(0, 60)}`));
      socket.on("data", (d) => console.log(`[ws] client→upstream ${d.length}B: ${d.toString("hex").slice(0, 60)}`));
      tlsSocket.pipe(socket);
      socket.pipe(tlsSocket);
    });
    tlsSocket.on("error", (e) => {
      console.log(`[ws] tls error: ${e.message}`);
      socket.destroy();
    });
  });
  connectReq.on("error", () => socket.destroy());
  socket.on("error", () => connectReq.destroy());
}

const httpServer = http.createServer(handleRequest);
httpServer.on("upgrade", handleUpgrade);
httpServer.listen(PORT, "127.0.0.1", () => console.log(`rpc-proxy HTTP: 127.0.0.1:${PORT} → ${PROXY} → ${TARGET}`));

// web3.js 按 HTTP 端口 +1 推导 WebSocket 端点
const wsServer = http.createServer((_req, res) => {
  res.writeHead(426, { "Content-Type": "text/plain" });
  res.end("websocket upgrade only");
});
wsServer.on("upgrade", handleUpgrade);
wsServer.listen(PORT + 1, "127.0.0.1", () => console.log(`rpc-proxy WS:   127.0.0.1:${PORT + 1} → wss://${targetUrl.host}`));
