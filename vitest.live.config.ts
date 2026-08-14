import { defineConfig } from "vitest/config"

/**
 * 只跑 `*.live.test.ts`：会起真实引擎子进程、消耗真实额度。
 * `pnpm test:live`。默认的 `pnpm test` 不含它们。
 */
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.live.test.ts", "apps/*/src/**/*.live.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
})
