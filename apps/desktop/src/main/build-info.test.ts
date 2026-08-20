import { describe, expect, it } from "vitest"
import { parseBuildInfo } from "./build-info.js"

describe("构建元数据", () => {
  const cases = [
    { raw: undefined, mode: "bundled", build: undefined },
    { raw: {}, mode: "bundled", build: undefined },
    { raw: { omni: { claudeExecutable: "other", build: 1 } }, mode: "bundled", build: undefined },
    { raw: { omni: { claudeExecutable: "system", build: "abc" } }, mode: "system", build: "abc" },
  ] as const

  it("只接受明确的轻量版标记与字符串构建号", () => {
    for (const item of cases) {
      const result = parseBuildInfo(item.raw)
      expect(result.claudeExecutable).toBe(item.mode)
      expect(result.build).toBe(item.build)
    }
  })
})
