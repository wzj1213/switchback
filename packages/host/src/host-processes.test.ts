import { describe, expect, it } from "vitest"
import { NO_CAPABILITIES } from "@omni/protocol"
import type { EngineDriver } from "@omni/engine"
import { createHost } from "./host.js"
import { create } from "./host-fixture.js"

/** 一家会报 pid 的引擎：外发守卫要靠这一行把流量记到会话上。 */
function driverWithPid(pid: number | undefined): EngineDriver {
  return {
    id: "fake",
    start: (req) =>
      Promise.resolve({
        threadId: req.threadId,
        prompt: () => Promise.resolve(),
        interrupt: () => Promise.resolve(),
        setTrust: () => Promise.resolve({ restart: false }),
        models: () => Promise.resolve([]),
        capabilities: () => NO_CAPABILITIES,
        setModel: () => Promise.resolve({}),
        dispose: () => Promise.resolve(),
        pid: () => pid,
      }),
  }
}

describe("每条活会话背后的引擎进程", () => {
  it("报了 pid 的会话列出来，连同是哪一家", async () => {
    const counter = { n: 0 }
    const host = createHost({
      drivers: { fake: driverWithPid(4321) },
      home: "/home/dev",
      emit: () => undefined,
      newId: (prefix) => `${prefix}-${String((counter.n += 1))}`,
      now: () => 0,
    })
    await host.dispatch(create)
    expect(host.processes()).toEqual([{ threadId: expect.any(String) as string, engine: "fake", pid: 4321 }])
  })

  it("进程已经退了（报不出 pid）就不列：免得把流量记到一个被复用的 pid 上", async () => {
    const host = createHost({
      drivers: { fake: driverWithPid(undefined) },
      home: "/home/dev",
      emit: () => undefined,
      newId: (prefix) => `${prefix}-x`,
      now: () => 0,
    })
    await host.dispatch(create)
    expect(host.processes()).toEqual([])
  })
})
