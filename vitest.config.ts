import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 审计/调试探针(留盘待 Phase 2 反转成验收测试)不参与常规测试运行
    // .tmp-*/ 是本地工具源目录(克隆的技能仓库),其自带测试不属于本项目
    exclude: ["**/*.tmp.*", "**/.tmp-*/**", "**/node_modules/**"],
  },
});
