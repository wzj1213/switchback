import { describe, expect, it } from "vitest"
import { initial, itemsOf, reduceAll } from "@omni/store"
import { promptEcho } from "./web-prompt.js"

describe("Web 验收台 prompt 回显", () => {
  it("用临时 turn 把消息归到命令指定的会话，并立即收口", () => {
    const events = promptEcho(
      { type: "thread.prompt", threadId: "t-长", text: "验收发送" },
      "codex",
      42,
    )
    const state = reduceAll(initial(), events)

    expect(itemsOf(state, "t-长")).toMatchObject([
      { kind: "user_message", text: "验收发送", turnId: "harness-prompt-42" },
    ])
    expect(itemsOf(state, "t-1")).toEqual([])
    expect(state.turns["t-长"]).toBeUndefined()
  })
})
