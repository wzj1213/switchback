import { describe, expect, it } from "vitest"
import type { Thread } from "@omni/protocol"
import type { LastUsed } from "../shared/settings.js"
import { learnFrom, openWith } from "./newThreadPrefs.js"

const EMPTY: LastUsed = { engine: "", byEngine: {} }

function thread(over: Partial<Thread>): Thread {
  return {
    id: "th-1",
    title: "t",
    cwd: "/w",
    engine: "codex",
    trust: "auto-edit",
    status: "idle",
    createdAt: 0,
    updatedAt: 0,
    engineHistory: ["codex"],
    ...over,
  }
}

describe("下次新会话开成什么样：用回去", () => {
  it("什么都没记过时用兜底", () => {
    expect(openWith(EMPTY, "", "claude")).toEqual({ engine: "claude" })
  })

  it("记过就用上次那一套", () => {
    const last: LastUsed = { engine: "codex", byEngine: { codex: { model: "gpt-5.3", effort: "high" } } }
    expect(openWith(last, "", "claude")).toEqual({ engine: "codex", model: "gpt-5.3", effort: "high" })
  })

  // 用户去设置里明写默认引擎，就是为了不再每次手挑——那句话该压过「上次用的」
  it("设置里明写的引擎压过上次用的", () => {
    const last: LastUsed = { engine: "codex", byEngine: { codex: { model: "gpt-5.3" } } }
    expect(openWith(last, "claude", "kimi").engine).toBe("claude")
  })

  /**
   * 这一条是这个模块存在的主要理由。模型 id 是引擎私有的：
   * 拿 codex 的模型去开 claude，开出来的是一条起不来的会话。
   */
  it("模型跟着最终选定的引擎查，不是跟着上次那家查", () => {
    const last: LastUsed = {
      engine: "codex",
      byEngine: { codex: { model: "gpt-5.3" }, claude: { model: "opus" } },
    }
    expect(openWith(last, "claude", "kimi")).toEqual({ engine: "claude", model: "opus" })
  })

  it("那家没记过模型时只给引擎，不硬塞一个别家的", () => {
    const last: LastUsed = { engine: "codex", byEngine: { codex: { model: "gpt-5.3" } } }
    expect(openWith(last, "kimi", "claude")).toEqual({ engine: "kimi" })
  })
})

describe("下次新会话开成什么样：记下来", () => {
  it("第一句话时把这一套记下", () => {
    expect(learnFrom(EMPTY, thread({ engine: "codex", model: "gpt-5.3", effort: "high" }))).toEqual({
      engine: "codex",
      byEngine: { codex: { model: "gpt-5.3", effort: "high" } },
    })
  })

  /**
   * **这条是用户明确要的**：跑到一半换个强模型是针对这段活的临时决定，
   * 不是「我以后都这么开」。记成偏好的话，为一个难题临时开的 high
   * 会跟着你到之后每一条新会话。
   */
  it("已经跑过一轮的会话再发消息，什么都不记", () => {
    const already = thread({
      engine: "claude",
      model: "opus",
      segments: [{ engine: "codex", handle: "h", startedAt: 1 }],
    })
    expect(learnFrom(EMPTY, already)).toBeUndefined()
  })

  // 退回引擎默认也是一次表态，不然下一条新会话又被拉回上上次那个模型
  it("这次没挑模型 = 用引擎默认，把那家原先记的删掉", () => {
    const last: LastUsed = { engine: "codex", byEngine: { codex: { model: "gpt-5.3" }, claude: { model: "opus" } } }
    expect(learnFrom(last, thread({ engine: "codex" }))).toEqual({
      engine: "codex",
      byEngine: { claude: { model: "opus" } },
    })
  })

  it("别家记着的不受影响", () => {
    const last: LastUsed = { engine: "claude", byEngine: { claude: { model: "opus" } } }
    expect(learnFrom(last, thread({ engine: "codex", model: "gpt-5.3" }))).toEqual({
      engine: "codex",
      byEngine: { claude: { model: "opus" }, codex: { model: "gpt-5.3" } },
    })
  })

  // 每条会话的第一句都写一次盘没有意义，还会白白触发一轮渲染
  it("和已经记着的一模一样时不写盘", () => {
    const last: LastUsed = { engine: "codex", byEngine: { codex: { model: "gpt-5.3" } } }
    expect(learnFrom(last, thread({ engine: "codex", model: "gpt-5.3" }))).toBeUndefined()
  })

  it("同一家只换了思维档也算变化", () => {
    const last: LastUsed = { engine: "codex", byEngine: { codex: { model: "gpt-5.3", effort: "low" } } }
    expect(learnFrom(last, thread({ engine: "codex", model: "gpt-5.3", effort: "high" }))?.byEngine).toEqual({
      codex: { model: "gpt-5.3", effort: "high" },
    })
  })
})
