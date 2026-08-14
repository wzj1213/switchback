import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    // 需要真实引擎进程的测试默认不跑：pnpm vitest run --mode live
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.live.test.ts"],
  },
})
