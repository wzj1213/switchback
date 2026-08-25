import { describe, expect, it } from "vitest"
import type { EngineStatus, Event } from "@omni/protocol"
import type { RpcPeer } from "../rpc.js"
import { reportAccount } from "./account.js"

/**
 * 账号侧的现状要在**动手之前**问出来。这里钉的是判据本身——
 * 形状来自本机 0.149.0 生成协议，并与官方 app-server 文档互相核对。
 */
const run = async (replies: Record<string, unknown>): Promise<{ said: string[]; events: Event[] }> => {
  const said: string[] = []
  const events: Event[] = []
  const rpc = {
    call: (method: string) =>
      method in replies ? Promise.resolve(replies[method]) : Promise.reject(new Error("没接这个方法")),
  } as unknown as RpcPeer
  reportAccount(rpc, (status: EngineStatus, detail?: string) => said.push(`${status}:${detail ?? ""}`), (e) => events.push(e))
  await new Promise((r) => setTimeout(r, 0))
  return { said, events }
}

describe("登没登录", () => {
  it("公开 account/read 的登出形状是 account:null", async () => {
    const { said } = await run({ "account/read": { account: null, requiresOpenaiAuth: true } })
    expect(said[0]).toContain("degraded")
    expect(said[0]).toContain("codex login")
  })

  it("登录了就不出声", async () => {
    const { said } = await run({ "account/read": { account: { type: "chatgpt" }, requiresOpenaiAuth: true } })
    expect(said).toEqual([])
  })

  it("API key 账号同样算已登录", async () => {
    const { said } = await run({ "account/read": { account: { type: "apiKey" }, requiresOpenaiAuth: true } })
    expect(said).toEqual([])
  })

  it("不需要 OpenAI 登录的配置一律不管", async () => {
    const { said } = await run({ "account/read": { account: null, requiresOpenaiAuth: false } })
    expect(said).toEqual([])
  })

  it("问不出来就静默——这是锦上添花，不该变成一条吓人的横幅", async () => {
    const { said } = await run({})
    expect(said).toEqual([])
  })
})

describe("额度：握手就问，不等跑完一轮才推", () => {
  it("读到就发出去", async () => {
    const { events } = await run({
      "account/rateLimits/read": { rateLimits: { primary: { usedPercent: 100, windowDurationMins: 10080 } } },
    })
    expect(events.filter((e) => e.type === "limits.updated")).toHaveLength(1)
  })

  it("完整快照明确没有窗口时清掉上一账号的额度", async () => {
    const { events } = await run({
      "account/rateLimits/read": { rateLimits: { primary: null, secondary: null } },
    })
    expect(events.find((e) => e.type === "limits.updated")).toMatchObject({ limits: {} })
  })

  it("请求本身失败才静默——锦上添花不能拖住开场", async () => {
    const { events } = await run({})
    expect(events).toEqual([])
  })
})
