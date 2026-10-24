import { describe, expect, it } from "vitest"
import { createAntigravityDriver } from "./driver.js"
import { fixture } from "./fixture.js"
import { turnArgs } from "./options.js"
import { parseModels } from "./models.js"

describe("Antigravity 原生入口", () => {
  it("只读档不假冒 plan；放权只跟随用户的 full 档", () => {
    expect(() => turnArgs({ trust: "read-only" })).toThrow("不是只读权限")
    expect(() => turnArgs({ trust: "read-only", locale: "en" })).toThrow("not a read-only permission")
    expect(turnArgs({ trust: "auto-edit" })).not.toContain("--dangerously-skip-permissions")
    expect(turnArgs({ trust: "full", conversation: "specific", model: "model" })).toEqual([
      "--input-format", "stream-json", "--output-format", "stream-json", "--mode", "accept-edits",
      "--dangerously-skip-permissions", "--conversation", "specific", "--model", "model",
    ])
  })

  it("模型只来自 agy models，不把提示文字变成模型", () => {
    expect(parseModels("Fetching available models...\na\tModel A\nb\tModel B\na\tModel A\n")).toEqual([
      { id: "a", label: "Model A", inputModalities: ["text"] },
      { id: "b", label: "Model B", inputModalities: ["text"] },
    ])
  })

  it("真实 pipe 传递原文、合并末尾增量、避免重复结果，并精确续聊", async () => {
    const f = await fixture()
    const session = await createAntigravityDriver(f.command).start(f.req)
    try {
      await session.activate?.()
      expect(await session.models()).toMatchObject([{ id: "test-model" }])
      await session.setModel("test-model")
      const original = "中文\n`literal` $HOME"
      await session.prompt(original, "one")
      await expect.poll(() => f.events.filter((e) => e.type === "turn.completed").length).toBe(1)
      expect(f.handles).toEqual(["conversation-1"])
      const final = f.events.findLast((e) => e.type === "item.updated")
      expect(final).toMatchObject({ item: { text: original + "!", complete: true } })
      await session.prompt("resume", "two")
      await expect.poll(() => f.events.filter((e) => e.type === "turn.completed").length).toBe(2)
      expect(f.events.findLast((e) => e.type === "item.updated")).toMatchObject({ item: { text: "conversation-1!" } })
      expect(f.events.filter((e) => e.type === "item.started")).toHaveLength(2)
      expect(session.pid?.()).toBeUndefined()
      expect(session.capabilities().attachments).toBe(false)
    } finally { await session.dispose(); await f.cleanup() }
  })

  it("地区资格失败与损坏帧都结束当前轮且保留原因", async () => {
    for (const [prompt, error] of [["auth", "not available in your location"], ["malformed", "stream-json"]] as const) {
      const f = await fixture()
      const session = await createAntigravityDriver(f.command).start(f.req)
      try {
        await session.prompt(prompt, "turn")
        await expect.poll(() => f.events.find((e) => e.type === "turn.completed")).toMatchObject({
          status: "failed", error: expect.stringContaining(error),
        })
      } finally { await session.dispose(); await f.cleanup() }
    }
  })

  it("停止回收进程，关闭后拒绝新输入，不接受附件或未知模型", async () => {
    const f = await fixture()
    const session = await createAntigravityDriver(f.command).start(f.req)
    try {
      await expect(session.prompt("text", "image", ["image.png"])).rejects.toThrow("只接受文本")
      await expect(session.setModel("unknown")).rejects.toThrow("模型列表中没有")
      await session.prompt("slow", "turn")
      await expect.poll(() => f.handles.length).toBe(1)
      await expect(session.setTrust("full")).rejects.toThrow("先停止")
      await expect(session.prompt("again", "again")).rejects.toThrow("正在运行")
      await session.interrupt()
      expect(f.events.filter((e) => e.type === "turn.completed")).toMatchObject([{ status: "interrupted" }])
      expect(session.pid?.()).toBeUndefined()
      await session.dispose()
      await expect(session.prompt("text", "closed")).rejects.toThrow("已关闭")
    } finally { await session.dispose(); await f.cleanup() }
  })
})
