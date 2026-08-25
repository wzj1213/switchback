import { describe, expect, it } from "vitest"
import { readKimiTranscript } from "./history.js"
import type { KimiApi } from "./http.js"
import type { KimiTranscriptPage } from "./wire.js"

function page(turns: readonly string[], hasMore: boolean): KimiTranscriptPage {
  return {
    has_more: hasMore,
    items: turns.map((turnId) => ({
      kind: "turn" as const,
      turnId,
      state: "completed" as const,
      prompt: `问${turnId}`,
      steps: [
        {
          frames: [
            {
              kind: "text" as const,
              frameId: `a${turnId}`,
              role: "assistant" as const,
              text: `答${turnId}`,
            },
          ],
        },
      ],
    })),
  }
}

describe("Kimi transcript 分页", () => {
  it("从最新页向前读全，返回准确总数和时间正序", async () => {
    const paths: string[] = []
    const pages = [page(["3", "4"], true), page(["1", "2"], false)]
    const api: KimiApi = {
      get: <T>(path: string) => {
        paths.push(path)
        return Promise.resolve(pages.shift() as T)
      },
      post: <T>() => Promise.resolve(undefined as T),
    }

    const got = await readKimiTranscript(api, "s1")

    expect(paths).toEqual([
      "sessions/s1/transcript?agent_id=main&page_size=100",
      "sessions/s1/transcript?agent_id=main&page_size=100&before_turn=3",
    ])
    expect(got.total).toBe(8)
    expect(
      got.items.filter((item) => item.kind === "user_message").map((item) => item.text),
    ).toEqual(["问1", "问2", "问3", "问4"])
  })

  it("页尾 user-slash marker 跨页归到下一轮", async () => {
    const newer = page(["2"], true)
    const older = page(["1"], false)
    older.items = [
      ...older.items,
      {
        kind: "marker",
        markerId: "m1",
        marker: "skill",
        payload: {
          origin: {
            kind: "skill_activation",
            activationId: "cross-page",
            skillName: "review",
            trigger: "user-slash",
          },
        },
      },
    ]
    const pages = [newer, older]
    const api: KimiApi = {
      get: <T>() => Promise.resolve(pages.shift() as T),
      post: <T>() => Promise.resolve(undefined as T),
    }

    const got = await readKimiTranscript(api, "s1")

    expect(got.items.find((item) => item.id === "kimi-activation-cross-page")).toMatchObject({
      turnId: "kimi-history-2",
      kind: "notice",
      message: "Activated skill: review",
    })
  })
})
