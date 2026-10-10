import { describe, expect, it } from "vitest"
import { inputItems, startTurn, type StartTurnContext } from "./turn.js"

function setup(call: StartTurnContext["call"]): StartTurnContext & { failures: string[] } {
  const failures: string[] = []
  const state: StartTurnContext["state"] = {
    codexThread: "native-thread",
    codexTurn: undefined,
    turn: undefined,
    model: "gpt",
    effort: "high",
  }
  return {
    state,
    call,
    failures,
    fail: (message) => {
      failures.push(message)
      state.turn = undefined
      state.codexTurn = undefined
    },
  }
}

describe("Codex 开轮次", () => {
  it("纯图片消息不夹一块空文本，纯文本仍带协议要求的 text_elements", () => {
    expect(inputItems("", ["/tmp/a.png"])).toEqual([{ type: "localImage", path: "/tmp/a.png" }])
    expect(inputItems("做事")).toEqual([{ type: "text", text: "做事", text_elements: [] }])
  })

  it("turn/start 失败会同步收掉宿主轮次，再把原错误抛回去", async () => {
    const ctx = setup(() => Promise.reject(new Error("上游拒绝")))
    await expect(startTurn(ctx, "做事", "turn-1")).rejects.toThrow("上游拒绝")
    expect(ctx.failures).toEqual(["上游拒绝"])
    expect(ctx.state.turn).toBeUndefined()
  })

  it("成功时记录原生 turn id，并把模型强度带到同一发", async () => {
    const calls: unknown[] = []
    const ctx = setup((_method, params) => {
      calls.push(params)
      return Promise.resolve({ turn: { id: "native-turn" } })
    })
    await startTurn(ctx, "做事", "turn-1", ["/tmp/a.png"])
    expect(ctx.state.codexTurn).toBe("native-turn")
    expect(calls[0]).toMatchObject({ model: "gpt", effort: "high" })
    expect(calls[0]).toMatchObject({ input: inputItems("做事", ["/tmp/a.png"]) })
  })

  it("回包之前就按了停止：拿到原生轮次 id 当场补发中断", async () => {
    const calls: { method: string; params: unknown }[] = []
    const ctx = setup((method, params) => {
      calls.push({ method, params })
      // 停止键在 turn/start 回包之前按下（驱动的 interrupt 只能先记下来）
      if (method === "turn/start") ctx.state.stopRequested = "turn-1"
      return Promise.resolve(method === "turn/start" ? { turn: { id: "native-turn" } } : {})
    })
    await startTurn(ctx, "做事", "turn-1")
    expect(calls.map((call) => call.method)).toEqual(["turn/start", "turn/interrupt"])
    expect(calls[1]?.params).toEqual({ threadId: "native-thread", turnId: "native-turn" })
    expect(ctx.state.stopRequested).toBeUndefined()
  })

  it("上一轮的 start 失败迟到时，不把已经接替它的新轮收掉", async () => {
    const ctx = setup(() => {
      ctx.state.turn = "turn-2"
      return Promise.reject(new Error("旧请求断线"))
    })
    await expect(startTurn(ctx, "旧轮", "turn-1")).rejects.toThrow("旧请求断线")
    expect(ctx.failures).toEqual([])
    expect(ctx.state.turn).toBe("turn-2")
  })

  it("响应回来前轮次已经收工时，不写回迟到 id，并尽力停止孤儿轮次", async () => {
    const calls: { method: string; params: unknown }[] = []
    const ctx = setup((method, params) => {
      calls.push({ method, params })
      if (method === "turn/start") {
        ctx.state.turn = undefined
        return Promise.resolve({ turn: { id: "late" } })
      }
      return Promise.resolve({})
    })
    await startTurn(ctx, "快任务", "turn-1")
    expect(ctx.state.codexTurn).toBeUndefined()
    expect(calls[1]).toEqual({
      method: "turn/interrupt",
      params: { threadId: "native-thread", turnId: "late" },
    })
  })
})
