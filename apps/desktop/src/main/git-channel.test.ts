import { describe, expect, it } from "vitest"
import type { WorksiteSearch } from "./worksite-search.js"
import { createGitChannels } from "./git-channel.js"
import type { GitRun } from "./git-commit.js"

const worksites = (owned: string): WorksiteSearch => ({
  note: () => undefined,
  noteHistory: () => undefined,
  owns: (threadId, cwd) => threadId === "t-1" && cwd === owned,
  search: () => Promise.resolve([]),
})

describe("提交通道的守卫与排队", () => {
  it("不是会话在用的工作区：一个 git 命令都不跑", async () => {
    const calls: string[][] = []
    const run: GitRun = (args) => {
      calls.push([...args])
      return Promise.resolve({ ok: true, stdout: "/w\n", stderr: "" })
    }
    const channels = createGitChannels(worksites("/w"), run)
    expect(await channels.state({ threadId: "t-2", cwd: "/w" })).toMatchObject({ repo: false })
    expect((await channels.commit({ threadId: "t-1", cwd: "/elsewhere", message: "x" })).ok).toBe(false)
    expect((await channels.stage({ threadId: "t-1", cwd: "/w", rel: "" })).ok).toBe(false)
    expect((await channels.commit({ threadId: "t-1", cwd: "/w", message: 42 })).ok).toBe(false)
    expect(calls).toEqual([])
  })

  it("同一个工作区的写操作排队：前一个没跑完，后一个不开始", async () => {
    const order: string[] = []
    const run: GitRun = async (args) => {
      if (args[0] === "rev-parse") return { ok: true, stdout: "/w\n", stderr: "" }
      order.push(`start ${args.join(" ")}`)
      await new Promise((resolve) => setTimeout(resolve, args.includes("a.txt") ? 60 : 5))
      order.push(`end ${args.join(" ")}`)
      return { ok: true, stdout: "", stderr: "" }
    }
    const channels = createGitChannels(worksites("/w"), run)
    await Promise.all([
      channels.stage({ threadId: "t-1", cwd: "/w", rel: "a.txt", stage: true }),
      channels.stage({ threadId: "t-1", cwd: "/w", rel: "b.txt", stage: true }),
    ])
    expect(order).toEqual(["start add -A -- a.txt", "end add -A -- a.txt", "start add -A -- b.txt", "end add -A -- b.txt"])
  })
})
