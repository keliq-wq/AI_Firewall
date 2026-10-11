/** @type {import('next').NextConfig} */
const nextConfig = {
  // 纯静态导出：可直接部署到任意静态托管（GitHub Pages / Vercel / 对象存储）
  output: "export",
  trailingSlash: true,
  // GitHub Pages 部署在子路径 /AI_Firewall/ 下；本地预览不设即空
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
};

export default nextConfig;
