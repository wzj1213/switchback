import type { Event } from "@omni/protocol"
import { describe, expect, it } from "vitest"
import type { KimiApi } from "./http.js"
import { KimiPrompter } from "./prompt.js"
import { KimiTurnTracker } from "./turn.js"

describe("Kimi prompt 原生状态", () => {
  it("v2 Hook 先发无 turnId 结果、再返回 blocked 时保留内容并正常收口，不取消已结束 prompt", async () => {
    const events: Event[] = []
    const posts: string[] = []
    const turn = new KimiTurnTracker({ emit: (event) => events.push(event), now: () => 9 })
    const api: KimiApi = {
      get: <T>() => Promise.resolve({ skills: [] } as T),
      post: <T>(path: string) => {
        posts.push(path)
        turn.hookResult({
          type: "hook.result", hookEvent: "UserPromptSubmit", content: "policy denied", blocked: true,
        }, 7)
        return Promise.resolve({ prompt_id: "prompt-1", status: "blocked" } as T)
      },
    }
    const prompt = new KimiPrompter(api, "session-1", turn)

    await expect(prompt.prompt("不要运行", "turn-1")).resolves.toBeUndefined()
    expect(posts).toEqual(["sessions/session-1/prompts"])
    expect(events).toMatchObject([
      { type: "item.started", item: { kind: "agent_message", text: expect.stringContaining("policy denied") } },
      { type: "turn.completed", turnId: "turn-1", status: "failed", error: "Prompt hook blocked the request." },
    ])
  })
})
