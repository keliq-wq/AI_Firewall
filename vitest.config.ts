import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 审计/调试探针(留盘待 Phase 2 反转成验收测试)不参与常规测试运行
    exclude: ["**/*.tmp.*", "**/node_modules/**"],
  },
});
