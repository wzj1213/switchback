import { defineConfig } from "vitest/config"

/**
 * 需要真实引擎进程的测试（`*.live.test.ts`）默认不跑，要跑就：
 *
 * ```sh
 * pnpm vitest run --mode live packages/engine/src/codex/plan.live.test.ts
 * ```
 *
 * **上一版这句话是假的**：注释里就写着这条命令，但 `exclude` 是无条件的常量数组，
 * 没有任何东西读 `mode`——于是那些测试**用文档里的命令一条都跑不起来**，
 * 只会得到「No test files found」。一条跑不起来的哨兵等于没有哨兵，
 * 而它们恰恰是用来兜住「源码对了但线上不对」的那一类。
 */
export default defineConfig(({ mode }) => ({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "apps/*/harness/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", ...(mode === "live" ? [] : ["**/*.live.test.ts"])],
  },
}))
