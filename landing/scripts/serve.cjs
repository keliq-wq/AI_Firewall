/**
 * 零依赖静态服务器：跑 next build 导出的 out/（本地预览 landing page）
 * 用法: node scripts/serve.cjs [port] [outDir]
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.argv[2] || 3100);
const OUT_DIR = path.resolve(process.argv[3] || "out");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain",
  ".json": "application/json",
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(OUT_DIR, p);
    if (
      !file.startsWith(OUT_DIR) ||
      !fs.existsSync(file) ||
      fs.statSync(file).isDirectory()
    ) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => {
    // 不指定 host：Node 默认双栈监听（:: 含 IPv4-mapped），
    // 这样 localhost(→::1) 和 127.0.0.1 都能连上
    console.log(`serving ${OUT_DIR} at http://127.0.0.1:${PORT} (dual-stack)`);
  });
