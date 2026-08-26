import type { Event, Thread } from "@omni/protocol"
import type { Worksite } from "@omni/worksite"
import { describe, expect, it } from "vitest"
import { createWorksiteSearch } from "./worksite-search.js"

function threadEvent(type: "thread.started" | "thread.updated", id: string, cwd: string): Event {
  const thread = {
    id, title: id, cwd, engine: "codex", trust: "auto-edit", status: "idle",
    createdAt: 1, updatedAt: 1, engineHistory: ["codex"],
  } satisfies Thread
  return type === "thread.started"
    ? { type, at: 1, thread }
    : { type, at: 1, thread }
}

const removed = (threadId: string): Event => ({ type: "thread.removed", at: 2, threadId })

function fakeFactory(state: {
  made: string[]
  invalidated: string[]
  queries: string[]
}): (cwd: string) => Worksite {
  return (cwd) => {
    state.made.push(cwd)
    return {
      search: async (query) => {
        state.queries.push(query)
        return [{ path: `${cwd}:${query}`, score: 1 }]
      },
      invalidate: () => { state.invalidated.push(cwd) },
    }
  }
}

describe("主进程工作区文件搜索", () => {
  it("只搜索真实 thread 持有的绝对工作区，共享目录等最后一个 owner 删除才失效", async () => {
    const calls = { made: [] as string[], invalidated: [] as string[], queries: [] as string[] }
    const search = createWorksiteSearch(fakeFactory(calls))
    await expect(search.search({ cwd: "/private", query: "secret" })).resolves.toEqual([])
    search.note(threadEvent("thread.started", "th-a", "/work"))
    search.note(threadEvent("thread.started", "th-b", "/work"))
    await expect(search.search({ cwd: "relative", query: "x" })).resolves.toEqual([])
    await expect(search.search({ cwd: "/work", query: "x" })).resolves.toEqual([
      "/work:x",
    ])

    search.note(removed("th-a"))
    await expect(search.search({ cwd: "/work", query: "y" })).resolves.toEqual([
      "/work:y",
    ])
    search.note(removed("th-b"))
    await expect(search.search({ cwd: "/work", query: "z" })).resolves.toEqual([])
    expect(calls.invalidated).toEqual(["/work"])
  })

  it("索引按最近使用保留，超限会失效最久没用的一份并可按需重建", async () => {
    const calls = { made: [] as string[], invalidated: [] as string[], queries: [] as string[] }
    const search = createWorksiteSearch(fakeFactory(calls), 2)
    search.noteHistory([
      threadEvent("thread.started", "th-a", "/a"),
      threadEvent("thread.started", "th-b", "/b"),
      threadEvent("thread.started", "th-c", "/c"),
    ])
    for (const cwd of ["/a", "/b", "/a", "/c", "/b"]) {
      await search.search({ cwd, query: "q" })
    }
    expect(calls.made).toEqual(["/a", "/b", "/c", "/b"])
    expect(calls.invalidated).toEqual(["/b", "/a"])
  })

  it("非法请求不建索引，超长查询在扫描前截断", async () => {
    const calls = { made: [] as string[], invalidated: [] as string[], queries: [] as string[] }
    const search = createWorksiteSearch(fakeFactory(calls))
    search.note(threadEvent("thread.started", "th", "/work"))
    await expect(search.search(undefined)).resolves.toEqual([])
    await expect(search.search({ cwd: "/work", query: 42 })).resolves.toEqual([])
    await search.search({ cwd: "/work", query: "x".repeat(1000) })
    expect(calls.made).toEqual(["/work"])
    expect(calls.queries[0]).toHaveLength(256)
  })
})
