import { describe, expect, it } from "vitest"
import { buildRegistry } from "./registry.js"
import type { Logger } from "./log.js"

const log: Logger = { file: "/tmp/omni-registry-test.log", write: () => undefined }

describe("内置引擎注册表", () => {
  it("DSH 有真驱动；是否进入清单由设置层决定，不由渲染层占位冒充", () => {
    const registry = buildRegistry("/tmp/omni-no-user-engines", log)
    expect(registry.drivers["dsh"]?.id).toBe("dsh")
    expect(registry.labels["dsh"]).toBe("DSH")
  })
})
