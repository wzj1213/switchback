import { describe, expect, it } from "vitest"
import type { Trust } from "@switchback/protocol"
import { callFor, unpackBytes } from "./calls.js"
import type { Device } from "./tokens.js"

function device(over: Partial<Device> = {}): Device {
  return { id: "d1", name: "mac2", hash: "h", createdAt: 0, lastSeenAt: 0, kind: "desk", ...over }
}

function harness(found: Device | undefined, fallback: Trust = "auto-edit") {
  const calls: { name: string; arg: unknown }[] = []
  const call = callFor(
    {
      tokens: { get: () => (found === undefined ? undefined : { ...found }) },
      defaultTrust: () => fallback,
      find: (name) =>
        name === "switchback:missing"
          ? undefined
          : (arg) => {
              calls.push({ name, arg })
              return { echoed: arg }
            },
      log: () => undefined,
    },
    "d1",
  )
  return { call, calls }
}

describe("按设备落地一次调用", () => {
  it("电脑调读通道：找到处理函数、把参数交过去、把值带回来", async () => {
    const h = harness(device())
    expect(await h.call("switchback:worksite", { cwd: "/w" })).toEqual({ ok: true, value: { echoed: { cwd: "/w" } } })
    expect(h.calls).toEqual([{ name: "switchback:worksite", arg: { cwd: "/w" } }])
  })

  it("**每次现查记录**：被吊销的设备下一次调用就拒", async () => {
    expect(await harness(undefined).call("switchback:worksite", {})).toEqual({ ok: false, reason: "这台设备已经被吊销" })
  })

  it("老记录没有种类字段的按手机算——一条通道都不给", async () => {
    const h = harness(device({ kind: undefined }))
    const outcome = await h.call("switchback:worksite", {})
    expect(outcome.ok).toBe(false)
    expect(h.calls).toEqual([])
  })

  it("**设备自己的上限压过全局那条**：全局完全、这台只读 → 写类照样拒", async () => {
    const h = harness(device({ maxTrust: "read-only" }), "full")
    const outcome = await h.call("switchback:gitCommit", {})
    expect(outcome.ok ? "" : outcome.reason).toContain("只读")
    expect(h.calls).toEqual([])
  })

  it("设备没有自己的上限时跟着全局走", async () => {
    const outcome = await harness(device(), "read-only").call("switchback:gitStage", {})
    expect(outcome.ok).toBe(false)
  })

  it("白名单里有、表上却没挂：明说，不假装做了", async () => {
    // 借一条真在白名单里的名字：把 `find` 换成永远找不到
    const h = callFor(
      { tokens: { get: () => device() }, defaultTrust: () => "full", find: () => undefined, log: () => undefined },
      "d1",
    )
    const outcome = await h("switchback:worksite", {})
    expect(outcome.ok ? "" : outcome.reason).toContain("没有挂这条通道")
  })

  it("贴图的字节在落地前还原成 Buffer", async () => {
    const h = harness(device())
    await h.call("switchback:stashImage", { mime: "image/png", bytes: { $bytes: Buffer.from("png!").toString("base64") } })
    const arg = h.calls[0]?.arg as { bytes: unknown }
    expect(Buffer.isBuffer(arg.bytes)).toBe(true)
    expect(String(arg.bytes)).toBe("png!")
  })
})

describe("线上的字节", () => {
  it("只还原第一层；更深的、数组、标量原样不动", () => {
    const nested = { inner: { $bytes: "aGk=" } }
    expect(unpackBytes({ a: 1, nested })).toEqual({ a: 1, nested })
    expect(unpackBytes([{ $bytes: "aGk=" }])).toEqual([{ $bytes: "aGk=" }])
    expect(unpackBytes("x")).toBe("x")
    expect(unpackBytes(undefined)).toBeUndefined()
  })

  it("`$bytes` 不是字符串就不认", () => {
    expect(unpackBytes({ b: { $bytes: 1 } })).toEqual({ b: { $bytes: 1 } })
  })
})
