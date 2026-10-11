/**
 * 完工审查截图：静态导出 out/ 起本地服务，用系统 Edge（无头）拍
 *   .impeccable/review/desktop.png  (1440 宽，全页)
 *   .impeccable/review/mobile.png   (390 宽，全页)
 * 用法: node scripts/screenshot.cjs [outDir]
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const OUT_DIR = path.resolve(process.argv[2] || "out");
const REVIEW_DIR = path.resolve("../.impeccable/review");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

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

function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p.endsWith("/")) p += "index.html";
      const file = path.join(dir, p);
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

(async () => {
  const server = await serve(OUT_DIR);
  const port = server.address().port;

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: "new",
    args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
  });

  fs.mkdirSync(REVIEW_DIR, { recursive: true });

  async function shot(width, height, name, lang) {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.goto(`http://127.0.0.1:${port}/${lang}/`, {
      waitUntil: "networkidle0",
    });
    // 等印章动画落定（否则 capture 抓到中间帧）
    await page.evaluate(() => new Promise((r) => setTimeout(r, 900)));
    await page.screenshot({
      path: path.join(REVIEW_DIR, name),
      fullPage: true,
    });
    await page.close();
    console.log(`shot ${name} (${lang}, ${width}px)`);
  }

  await shot(1440, 900, "desktop.png", "en");
  await shot(390, 844, "mobile.png", "en");
  await shot(390, 844, "mobile-zh.png", "zh");

  await browser.close();
  server.close();
  console.log("done ->", REVIEW_DIR);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
