import { describe, expect, it } from "vitest"
import type { Thread } from "@switchback/protocol"
import type { ThreadRow } from "@switchback/store"
import { filterRows } from "./filter.js"

const row = (title: string, cwd: string, preview?: string): ThreadRow => ({
  thread: {
    id: title,
    title,
    cwd,
    engine: "codex",
    trust: "auto-edit",
    status: "idle",
    createdAt: 0,
    updatedAt: 0,
    engineHistory: ["codex"],
  } satisfies Thread,
  preview,
})

const ROWS = [
  row("switchback", "/Users/w/work/switchback", "给 math.js 的 add 加一行 JSDoc"),
  row("tmp.abc", "/tmp/tmp.abc", "读一下 notes.txt"),
  row("学习笔记", "/Users/w/learn/notes"),
]

describe("侧栏筛选", () => {
  it("空查询原样返回，顺序不动", () => {
    expect(filterRows(ROWS, "")).toBe(ROWS)
    expect(filterRows(ROWS, "   ")).toBe(ROWS)
  })

  it("搜标题", () => {
    expect(filterRows(ROWS, "学习").map((r) => r.thread.id)).toEqual(["学习笔记"])
  })

  it("搜第一句话——**记得住的往往是这个**，不是标题", () => {
    expect(filterRows(ROWS, "notes.txt").map((r) => r.thread.id)).toEqual(["tmp.abc"])
  })

  it("搜路径片段", () => {
    expect(filterRows(ROWS, "work").map((r) => r.thread.id)).toEqual(["switchback"])
  })

  it("不分大小写", () => {
    expect(filterRows(ROWS, "JSDOC").map((r) => r.thread.id)).toEqual(["switchback"])
    expect(filterRows(ROWS, "jsdoc").map((r) => r.thread.id)).toEqual(["switchback"])
  })

  it("**多个词是「与」，而且可以跨字段**——「Switchback JSDoc」= 在 Switchback 目录里问 JSDoc 的那个", () => {
    expect(filterRows(ROWS, "Switchback JSDoc").map((r) => r.thread.id)).toEqual(["switchback"])
    expect(filterRows(ROWS, "Switchback notes").map((r) => r.thread.id)).toEqual([])
  })

  it("没有 preview 的行不会因此炸掉", () => {
    expect(filterRows(ROWS, "笔记").map((r) => r.thread.id)).toEqual(["学习笔记"])
  })

  it("一个都不匹配就返回空——由界面说「没找到」，不是显示全部", () => {
    expect(filterRows(ROWS, "根本没有这个东西")).toEqual([])
  })
})
