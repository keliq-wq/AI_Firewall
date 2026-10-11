/**
 * 部署基路径：GitHub Pages 下为 /AI_Firewall，本地/根域名部署为空。
 * next/link 与 useRouter 会由 Next 自动处理 basePath，
 * 只有手写的 <a href> 需要手动拼接（用 lp()）。
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const lp = (path: string) => `${BASE_PATH}${path}`;
