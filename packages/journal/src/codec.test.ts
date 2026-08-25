import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { decode, decodeAll, encode, fileNameOf, shouldPersist, threadIdOf } from "./codec.js"

const started: Event = {
  type: "thread.started",
  at: 1,
  thread: {
    id: "th-1",
    title: "工作区",
    cwd: "/w",
    engine: "codex",
    trust: "auto-edit",
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    engineHistory: ["codex"],
  },
}

describe("shouldPersist", () => {
  it("普通 item.delta 等终态快照；明确带 threadId 的无终态流自己落盘", () => {
    expect(shouldPersist({ type: "item.delta", at: 1, itemId: "i", append: "x" })).toBe(false)
    expect(shouldPersist({
      type: "item.delta", at: 1, threadId: "th-1", itemId: "i", append: "monitor output",
    })).toBe(true)
    expect(shouldPersist({
      type: "item.delta", at: 1, threadId: "", itemId: "i", append: "orphan",
    })).toBe(false)
  })

  it("engine.status 不落盘——它描述的是**那一次进程**，重放会误导人", () => {
    expect(shouldPersist({ type: "engine.status", at: 1, threadId: "t", status: "ready" })).toBe(false)
  })

  it("原生通知不落盘——它属于一次性通知队列", () => {
    expect(shouldPersist({
      type: "engine.notification", at: 1, threadId: "t", engine: "claude",
      key: "k", message: "刚刚发生的事", priority: "medium",
    })).toBe(false)
  })

  it("思考 token 不落盘——它只是当前思考块的近似进度", () => {
    expect(shouldPersist({
      type: "thinking.updated", at: 1, threadId: "th", turnId: "tu", estimatedTokens: 42,
    })).toBe(false)
  })

  it("其余都落", () => {
    expect(shouldPersist(started)).toBe(true)
    expect(shouldPersist({ type: "turn.completed", at: 1, turnId: "t", status: "completed" })).toBe(true)
    expect(shouldPersist({ type: "item.removed", at: 1, turnId: "t", itemId: "i" })).toBe(true)
  })
})

describe("encode / decode", () => {
  it("往返之后一模一样", () => {
    expect(decode(encode(started))).toEqual(started)
  })

  it("坏行返回 undefined 而不是抛——SIGKILL 掉的进程最后一行几乎必然是残缺的", () => {
    expect(decode('{"type":"thread.star')).toBeUndefined()
  })

  it("空行跳过", () => {
    expect(decode("   ")).toBeUndefined()
  })

  it("是 JSON 但不是事件的也挡掉", () => {
    expect(decode("[1,2,3]")).toBeUndefined()
    expect(decode('{"no":"type"}')).toBeUndefined()
  })

  it("整段解析时坏行只丢那一行，不丢整个会话的历史", () => {
    const text = `${encode(started)}\n{"broken\n${encode(started)}\n`
    expect(decodeAll(text)).toHaveLength(2)
  })
})

describe("文件名", () => {
  it("正常 id 加后缀", () => {
    expect(fileNameOf("th-abc_1.2")).toBe("th-abc_1.2.jsonl")
  })

  it("带路径分隔符的 id 一律拒绝——不然写入能跑到目录外面去", () => {
    expect(fileNameOf("../../etc/passwd")).toBeUndefined()
    expect(fileNameOf("a/b")).toBeUndefined()
    expect(fileNameOf("")).toBeUndefined()
  })

  it("反解只认 .jsonl", () => {
    expect(threadIdOf("th-1.jsonl")).toBe("th-1")
    expect(threadIdOf("th-1.txt")).toBeUndefined()
    expect(threadIdOf(".jsonl")).toBeUndefined()
  })
})
