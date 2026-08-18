import { describe, expect, it } from "vitest"
import type { Event, Item, Thread } from "@omni/protocol"
import { initial, reduceAll, type ViewState } from "@omni/store"
import { freshOnly } from "./useRemote.js"

const record: Thread = {
  id: "t",
  title: "t",
  cwd: "/w",
  engine: "codex",
  trust: "auto-edit",
  status: "idle",
  createdAt: 0,
  updatedAt: 0,
  engineHistory: ["codex"],
}

const msg = (id: string, text: string): Item => ({
  id,
  turnId: "u",
  kind: "agent_message",
  at: 0,
  text,
  complete: false,
})

const started = (id: string, text: string): Event => ({ type: "item.started", at: 0, item: msg(id, text) })

/** 一个已经收着 `i-1` 的状态。**轮次要先起**——归约器靠 `turnId` 认这条 item 属于哪条会话。 */
function withItem(): ViewState {
  return reduceAll(initial(), [
    { type: "thread.started", at: 0, thread: record },
    { type: "turn.started", at: 0, turn: { id: "u", threadId: "t", engine: "codex", status: "running", startedAt: 0 } },
    started("i-1", "在写"),
  ])
}

describe("补来的正文和正在流的内容撞车", () => {
  it("**磁盘上的旧快照盖不掉正在流的那条**——这是分级 replay 最容易出的错", () => {
    const state = reduceAll(withItem(), [{ type: "item.delta", at: 1, itemId: "i-1", append: "了一半" }])
    const fresh = freshOnly(state, "t", [started("i-1", "在写"), { type: "item.delta", at: 0, itemId: "i-1", append: "" }])
    expect(fresh).toEqual([])
  })

  it("没见过的条目照收", () => {
    const fresh = freshOnly(withItem(), "t", [started("i-2", "新的")])
    expect(fresh).toHaveLength(1)
  })

  it("**一条都没见过时整份直收**——第一次打开这条会话，没有可撞的东西", () => {
    const events = [started("i-1", "a"), started("i-2", "b")]
    expect(freshOnly(initial(), "t", events)).toBe(events)
  })

  it("只滤条目类的事件；会话头、轮次这些照过", () => {
    const events: Event[] = [
      { type: "thread.updated", at: 2, thread: { ...record, title: "改过名" } },
      started("i-1", "在写"),
      { type: "turn.completed", at: 3, turnId: "u", status: "completed" },
    ]
    expect(freshOnly(withItem(), "t", events).map((e: Event) => e.type)).toEqual(["thread.updated", "turn.completed"])
  })

  it("**判据是这条会话自己的条目**——别条会话里同名的 id 不算见过", () => {
    const events = [started("i-1", "在写")]
    expect(freshOnly(withItem(), "别条", events)).toBe(events)
  })

  it("item.updated 也按 id 滤——重放一份旧的等于把内容改回去", () => {
    const fresh = freshOnly(withItem(), "t", [{ type: "item.updated", at: 0, item: msg("i-1", "旧的") }])
    expect(fresh).toEqual([])
  })
})
