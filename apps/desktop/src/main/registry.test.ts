import { describe, expect, it } from "vitest"
import { buildRegistry } from "./registry.js"
import type { Logger } from "./log.js"
import { BUILTIN_ENGINES } from "../shared/builtin-engines.js"

const log: Logger = { file: "/tmp/switchback-registry-test.log", write: () => undefined }

describe("内置引擎注册表", () => {
  it("DSH 有真驱动；是否进入清单由设置层决定，不由渲染层占位冒充", () => {
    const registry = buildRegistry("/tmp/switchback-no-user-engines", log)
    expect(registry.drivers["dsh"]?.id).toBe("dsh")
    expect(registry.labels["dsh"]).toBe("DSH")
  })

  it("共享清单里的五家都有真实驱动与同名标签", () => {
    const registry = buildRegistry("/tmp/switchback-no-user-engines", log)
    for (const engine of BUILTIN_ENGINES) {
      expect(registry.drivers[engine.id]?.id).toBe(engine.id)
      expect(registry.labels[engine.id]).toBe(engine.label)
    }
  })
})
