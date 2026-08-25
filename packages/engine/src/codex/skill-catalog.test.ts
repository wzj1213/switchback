import { describe, expect, it, vi } from "vitest"
import { createSkillCatalog } from "./skill-catalog.js"

const response = (name: string) => ({ data: [{ skills: [{ name, description: `${name} desc` }] }] })

describe("Codex skill 清单生命周期", () => {
  it("开场只查当前工作区，通知后强制重扫并允许空表清旧目录", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce(response("before"))
      .mockResolvedValueOnce({ data: [] })
    const events: unknown[] = []
    const catalog = createSkillCatalog({
      call,
      emit: (event) => events.push(event),
      cwd: "/work/current",
      threadId: "thread-1",
    })
    await expect(catalog.list()).resolves.toMatchObject([{ name: "before" }])
    expect(call).toHaveBeenNthCalledWith(1, "skills/list", { cwds: ["/work/current"] })
    catalog.changed()
    await vi.waitFor(() => expect(events).toHaveLength(1))
    expect(call).toHaveBeenNthCalledWith(2, "skills/list", {
      cwds: ["/work/current"],
      forceReload: true,
    })
    expect(events).toMatchObject([{ type: "commands.updated", engine: "codex", commands: [] }])
  })

  it("连续通知只采用最后一份回包，失败或关闭后的迟到结果不清目录", async () => {
    const resolvers: ((value: unknown) => void)[] = []
    const call = vi.fn(() => new Promise<unknown>((resolve) => resolvers.push(resolve)))
    const events: unknown[] = []
    const catalog = createSkillCatalog({ call, emit: (event) => events.push(event), cwd: "/w", threadId: "t" })
    catalog.changed()
    catalog.changed()
    resolvers[1]?.(response("new"))
    await vi.waitFor(() => expect(events).toHaveLength(1))
    resolvers[0]?.(response("old"))
    await Promise.resolve()
    expect(events).toMatchObject([{ type: "commands.updated", commands: [{ name: "new" }] }])

    catalog.changed()
    catalog.close()
    resolvers[2]?.(response("late"))
    await Promise.resolve()
    expect(events).toHaveLength(1)
  })
})
