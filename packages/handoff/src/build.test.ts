import { describe, expect, it } from "vitest"
import type { Item, Thread, ToolCallItem } from "@omni/protocol"
import { buildHandoff } from "./build.js"

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
const edit = (id: string, path: string, added: number, removed: number): ToolCallItem => ({
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

  it("同一个文件改多次只留最后一次成功上报，不把多轮数字累加成假净值", () => {
    const h = buildHandoff(thread, [edit("a", "/w/x.ts", 3, 1), edit("b", "/w/x.ts", 2, 0)])
    expect(h.changed).toEqual([{ path: "/w/x.ts", added: 2, removed: 0 }])
  })

  it("失败编辑和分叉继承记录不冒充这一边新做的改动", () => {
    const failed = { ...edit("bad", "/w/bad.ts", 8, 4), status: "failed" as const }
    const inherited = { ...edit("old", "/w/old.ts", 9, 2), inherited: true as const }
    expect(buildHandoff(thread, [failed, inherited]).changed).toEqual([])
  })

  it("分叉继承的共同历史不冒充子分支自己的要求、计划、裁决与结论", () => {
    const inherited = [
      { ...user("u", "共同要求"), inherited: true as const },
      { ...plan("p", [{ text: "共同计划", status: "pending" }]), inherited: true as const },
      { id: "ap", turnId: "t", kind: "approval" as const, at: 0, toolCallId: "x", tool: "shell",
        summary: "共同裁决", status: "allowed" as const, reason: "", inherited: true as const },
      { ...agent("a", "共同结论"), inherited: true as const },
    ]
    expect(buildHandoff(thread, inherited)).toMatchObject({
      goal: "omni", asks: [], decisions: [], open: [], last: undefined,
    })
  })

  it("相对、绝对与 macOS 临时目录别名指向同一文件时只占一行", () => {
    const tempThread = { ...thread, cwd: "/tmp/work" }
    const h = buildHandoff(tempThread, [
      edit("a", "./src/../x.ts", 3, 1),
      edit("b", "/private/tmp/work/x.ts", 2, 0),
    ])
    expect(h.changed).toEqual([{ path: "/private/tmp/work/x.ts", added: 2, removed: 0 }])
  })

  it("多文件任务不静默裁掉第 31 个之后的上报", () => {
    const items = Array.from({ length: 35 }, (_, i) => edit(`e${String(i)}`, `/w/${String(i)}.ts`, i, 0))
    expect(buildHandoff(thread, items).changed).toHaveLength(35)
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
