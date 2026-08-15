import { describe, expect, it } from "vitest"
import type { Item, Thread } from "@omni/protocol"
import { buildHandoff } from "./build.js"
import { renderHandoff } from "./render.js"

const thread: Thread = {
  id: "th",
  title: "omni",
  cwd: "/w",
  engine: "codex",
  trust: "auto-edit",
  status: "idle",
  createdAt: 0,
  updatedAt: 0,
  engineHistory: ["codex"],
}

const user = (id: string, text: string): Item => ({ id, turnId: "t", kind: "user_message", at: 0, text })
const agent = (id: string, text: string): Item => ({
  id, turnId: "t", kind: "agent_message", at: 0, text, complete: true,
})
const shell = (id: string, command: string, status: "ok" | "failed"): Item => ({
  id, turnId: "t", kind: "tool_call", at: 0, tool: "shell", status,
  detail: { kind: "shell", command },
})
const edit = (id: string, path: string, added: number, removed: number): Item => ({
  id, turnId: "t", kind: "tool_call", at: 0, tool: "apply_patch", status: "ok",
  detail: { kind: "file_edit", path, files: [{ path, kind: "update", added, removed }], added, removed },
})
const plan = (id: string, steps: readonly { text: string; status: "pending" | "done" | "dropped" }[]): Item => ({
  id, turnId: "t", kind: "plan", at: 0, steps,
})

describe("buildHandoff", () => {
  it("目标取第一条用户消息", () => {
    expect(buildHandoff(thread, [user("a", "把 X 改成 Y"), user("b", "顺便加测试")]).goal).toBe("把 X 改成 Y")
  })

  it("没有用户消息时退回会话标题，不给空串", () => {
    expect(buildHandoff(thread, []).goal).toBe("omni")
  })

  it("后续用户消息进「追加的要求」", () => {
    expect(buildHandoff(thread, [user("a", "一"), user("b", "二")]).asks).toEqual(["二"])
  })

  it("只收成功的命令——失败的命令交出去只会误导", () => {
    const h = buildHandoff(thread, [shell("a", "pnpm test", "ok"), shell("b", "pnpm bulid", "failed")])
    expect(h.commands).toEqual(["pnpm test"])
  })

  it("命令去重：跑过二十遍 pnpm test 只需要说一次", () => {
    const items = Array.from({ length: 20 }, (_, i) => shell(`c${String(i)}`, "pnpm test", "ok"))
    expect(buildHandoff(thread, items).commands).toEqual(["pnpm test"])
  })

  it("同一个文件被改多次要合并计数，不是流水账", () => {
    const h = buildHandoff(thread, [edit("a", "/w/x.ts", 3, 1), edit("b", "/w/x.ts", 2, 0)])
    expect(h.changed).toEqual([{ path: "/w/x.ts", added: 5, removed: 1 }])
  })

  it("**只取最后一份计划**——历史并集会把早就删掉的条目翻出来", () => {
    const h = buildHandoff(thread, [
      plan("p1", [{ text: "早就否决的方案", status: "pending" }]),
      plan("p2", [{ text: "现在的做法", status: "pending" }, { text: "做完了的", status: "done" }]),
    ])
    expect(h.open).toEqual(["现在的做法"])
  })

  it("裁决过的事要带上——换一家之后不该重问一遍", () => {
    const h = buildHandoff(thread, [
      { id: "ap", turnId: "t", kind: "approval", at: 0, toolCallId: "x", tool: "shell",
        summary: "推送到远端", status: "allowed", reason: "不可撤销" },
      { id: "ap2", turnId: "t", kind: "approval", at: 0, toolCallId: "y", tool: "shell",
        summary: "还没定的", status: "pending", reason: "" },
    ])
    expect(h.decisions).toEqual([{ summary: "推送到远端", allowed: true }])
  })

  it("上一家最后一段话带上", () => {
    expect(buildHandoff(thread, [agent("a", "第一段"), agent("b", "最后一段")]).last).toBe("最后一段")
  })
})

describe("renderHandoff", () => {
  const full = buildHandoff(thread, [
    user("a", "把 X 改成 Y"),
    edit("e", "/w/x.ts", 5, 2),
    shell("s", "pnpm test", "ok"),
    plan("p", [{ text: "补文档", status: "pending" }]),
  ])

  it("开头就说清「你是接手的」——不说的话模型会把它当成普通陈述复述一遍", () => {
    expect(renderHandoff(full, "Codex", "Claude Code")).toContain("接手")
  })

  it("明确「改动已经落盘，不要重做」", () => {
    expect(renderHandoff(full, "a", "b")).toContain("不要重做")
  })

  it("明确「已裁决的不要重问」——人工裁决成本最高，重来一遍最劝退", () => {
    expect(renderHandoff(full, "a", "b")).toContain("不要重新征求同意")
  })

  it("空的段落不出现，不留一堆空标题", () => {
    const bare = buildHandoff(thread, [user("a", "只有一个目标")])
    const text = renderHandoff(bare, "a", "b")
    // 查的是**小节标题**：「尚未完成」四个字在结尾那句叮嘱里也会出现
    expect(text).not.toContain("## 已改动的文件")
    expect(text).not.toContain("## 尚未完成")
    expect(text).toContain("只有一个目标")
  })
})
