import { describe, expect, it } from "vitest"
import { createChannels } from "./channels.js"

type Listener = (event: unknown, arg?: unknown) => unknown

function fakeIpc() {
  const handlers = new Map<string, Listener>()
  const listeners = new Map<string, Listener>()
  return {
    handlers,
    listeners,
    ipc: {
      handle: (name: string, fn: Listener) => {
        handlers.set(name, fn)
      },
      on: (name: string, fn: Listener) => {
        listeners.set(name, fn)
      },
    },
  }
}

describe("通道登记表", () => {
  it("**本机与远程调的是同一个函数**：IPC 那头丢掉 event，只把参数交过去", async () => {
    const fake = fakeIpc()
    const channels = createChannels(fake.ipc as never)
    channels.handle("switchback:worksite", (arg) => ({ got: arg }))
    expect(await fake.handlers.get("switchback:worksite")?.({ sender: 1 }, { cwd: "/w" })).toEqual({ got: { cwd: "/w" } })
    expect(channels.find("switchback:worksite")?.({ cwd: "/r" })).toEqual({ got: { cwd: "/r" } })
  })

  it("不回话的通道照样登记，远程调它得到 undefined", () => {
    const fake = fakeIpc()
    const channels = createChannels(fake.ipc as never)
    const seen: unknown[] = []
    channels.on("switchback:drafts/save", (arg) => {
      seen.push(arg)
    })
    fake.listeners.get("switchback:drafts/save")?.({}, { key: "t" })
    expect(channels.find("switchback:drafts/save")?.({ key: "r" })).toBeUndefined()
    expect(seen).toEqual([{ key: "t" }, { key: "r" }])
  })

  it("**同名挂两次当场炸**——`on` 自己不会报，会安静地让一次 send 跑两遍", () => {
    const channels = createChannels(fakeIpc().ipc as never)
    channels.on("switchback:discardImages", () => undefined)
    expect(() => {
      channels.on("switchback:discardImages", () => undefined)
    }).toThrow("挂了两次")
    expect(() => {
      channels.handle("switchback:discardImages", () => undefined)
    }).toThrow("挂了两次")
  })

  it("没登记的找不到", () => {
    expect(createChannels(fakeIpc().ipc as never).find("switchback:selfUpdate")).toBeUndefined()
  })
})
