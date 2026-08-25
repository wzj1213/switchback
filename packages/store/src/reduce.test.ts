import { describe, expect, it } from "vitest"
import type { Event, Item, Thread, ToolCallItem } from "@omni/protocol"
import { initial, itemsOf, limitsOf, threadsOf, threadRowsOf } from "./state.js"
import { coalesce, reduce, reduceAll, reduceHistory } from "./reduce.js"

const thread = (id: string): Thread => ({
  id,
  title: id,
  cwd: "/w",
  engine: "claude",
  trust: "auto-edit",
  status: "idle",
  createdAt: 0,
  updatedAt: 0,
  engineHistory: ["claude"],
})

const started = (id: string): Event => ({ type: "thread.started", at: 0, thread: thread(id) })

const turnStarted = (threadId: string, turnId: string): Event => ({
  type: "turn.started",
  at: 0,
  turn: { id: turnId, threadId, engine: "claude", status: "running", startedAt: 0 },
})

const msg = (id: string, turnId: string, text: string): Item => ({
  id,
  turnId,
  kind: "agent_message",
  at: 0,
  text,
  complete: false,
})

describe("reduce", () => {
  it("新会话进表且排在最前", () => {
    const s = reduceAll(initial(), [started("a"), started("b")])
    expect(threadsOf(s).map((t) => t.id)).toEqual(["b", "a"])
  })

  it("同一会话再次上报不会重复进顺序表", () => {
    const s = reduceAll(initial(), [started("a"), started("a")])
    expect(s.order).toEqual(["a"])
  })

  it("item 通过 turn 归属到会话", () => {
    const s = reduceAll(initial(), [
      started("a"),
      turnStarted("a", "t1"),
      { type: "item.started", at: 0, item: msg("i1", "t1", "hi") },
    ])
    expect(itemsOf(s, "a")).toHaveLength(1)
  })

  it("轮次未知的 item 被丢弃，而不是崩掉", () => {
    const s = reduce(initial(), { type: "item.started", at: 0, item: msg("i1", "ghost", "x") })
    expect(s).toEqual(initial())
  })

  it("delta 追加到流式文本上", () => {
    const s = reduceAll(initial(), [
      started("a"),
      turnStarted("a", "t1"),
      { type: "item.started", at: 0, item: msg("i1", "t1", "he") },
      { type: "item.delta", at: 0, itemId: "i1", append: "llo" },
    ])
    const first = itemsOf(s, "a")[0]
    expect(first?.kind === "agent_message" ? first.text : "").toBe("hello")
  })

  it("delta 打到非文本 item 上不改变它", () => {
    // shell 的输出现在**是**流式的（见下方「shell 输出的实时增量」），
    // 所以这条用一个不吃增量的形态来守「认不出就原样返回」这条规则
    const tool: Item = {
      id: "i2",
      turnId: "t1",
      kind: "tool_call",
      at: 0,
      tool: "Read",
      status: "running",
      detail: { kind: "file_read", path: "/w/a.ts" },
    }
    const s = reduceAll(initial(), [
      started("a"),
      turnStarted("a", "t1"),
      { type: "item.started", at: 0, item: tool },
      { type: "item.delta", at: 0, itemId: "i2", append: "ignored" },
    ])
    expect(itemsOf(s, "a")[0]).toEqual(tool)
  })

  it("撤回会删除 item 与反查项，重复撤回和迟到更新都不能把它复活", () => {
    const seeded = reduceAll(initial(), [
      started("a"),
      turnStarted("a", "t1"),
      { type: "item.started", at: 0, item: msg("i1", "t1", "不再有效") },
    ])
    const removed: Event = { type: "item.removed", at: 1, turnId: "t1", itemId: "i1" }
    const once = reduce(seeded, removed)
    const twice = reduce(once, removed)
    const late = reduce(twice, { type: "item.updated", at: 2, item: msg("i1", "t1", "复活") })
    expect(itemsOf(late, "a")).toEqual([])
    expect(late.owner["i1"]).toBeUndefined()
    expect(twice).toBe(once)
  })

  it("turn.completed 清掉当前轮次", () => {
    const s = reduceAll(initial(), [
      started("a"),
      turnStarted("a", "t1"),
      { type: "turn.completed", at: 0, turnId: "t1", status: "completed" },
    ])
    expect(s.turns["a"]).toBeUndefined()
  })

  it("认不出的事件原样返回旧状态", () => {
    const before = reduceAll(initial(), [started("a")])
    const after = reduce(before, { type: "engine.status", at: 0, threadId: "a", status: "ready" })
    expect(after).toBe(before)
  })

  it("归约是不可变的——旧状态不被改写", () => {
    const before = reduceAll(initial(), [started("a")])
    reduce(before, started("b"))
    expect(before.order).toEqual(["a"])
  })

  it("额度按窗口合并，空对象才清掉旧值", () => {
    const primary = { usedPercent: 20, windowDurationMins: 10_080 }
    const secondary = { usedPercent: 80, windowDurationMins: 300 }
    const first = reduce(initial(), {
      type: "limits.updated", at: 1, engine: "codex", limits: { primary },
    })
    const both = reduce(first, {
      type: "limits.updated", at: 2, engine: "codex", limits: { secondary },
    })
    expect(limitsOf(both, "codex")).toEqual({ primary, secondary })

    const cleared = reduce(both, {
      type: "limits.updated", at: 3, engine: "codex", limits: {},
    })
    expect(limitsOf(cleared, "codex")).toEqual({})
  })
})

describe("shell 输出的实时增量", () => {
  const call = (output?: string): ToolCallItem => ({
    id: "e1",
    turnId: "tn1",
    kind: "tool_call",
    at: 0,
    tool: "shell",
    status: "running",
    detail: { kind: "shell", command: "pnpm build", ...(output === undefined ? {} : { output }) },
  })

  const seeded = (): ReturnType<typeof initial> =>
    reduceAll(initial(), [
      started("t1"),
      turnStarted("t1", "tn1"),
      { type: "item.started", at: 0, item: call() },
    ])

  const outputOf = (state: ReturnType<typeof initial>): string => {
    const item = itemsOf(state, "t1")[0]
    if (item?.kind !== "tool_call" || item.detail.kind !== "shell") return ""
    return item.detail.output ?? ""
  }

  it("追加到 shell 的 output——命令跑着时看得到滚动，全靠这条", () => {
    const next = reduceAll(seeded(), [
      { type: "item.delta", at: 1, itemId: "e1", append: "line 1\n" },
      { type: "item.delta", at: 2, itemId: "e1", append: "line 2\n" },
    ])
    expect(outputOf(next)).toBe("line 1\nline 2\n")
  })

  it("留尾不留头：超过上限只保留最近的输出", () => {
    const next = reduceAll(seeded(), [
      { type: "item.delta", at: 1, itemId: "e1", append: "旧".repeat(9000) },
      { type: "item.delta", at: 2, itemId: "e1", append: "新" },
    ])
    const out = outputOf(next)
    expect(out).toHaveLength(8000)
    expect(out.endsWith("新")).toBe(true)
  })

  it("收工时整条替换，不会把流过的输出再拼一遍", () => {
    const streamed = reduceAll(seeded(), [{ type: "item.delta", at: 1, itemId: "e1", append: "line 1\n" }])
    const done = reduce(streamed, {
      type: "item.updated",
      at: 2,
      item: { ...call("line 1\n"), status: "ok" },
    })
    expect(outputOf(done)).toBe("line 1\n")
  })

  it("非 shell 的工具调用不吃增量——diff 不是流式的", () => {
    const state = reduceAll(initial(), [
      started("t1"),
      turnStarted("t1", "tn1"),
      {
        type: "item.started",
        at: 0,
        item: {
          id: "f1",
          turnId: "tn1",
          kind: "tool_call",
          at: 0,
          tool: "apply_patch",
          status: "running",
          detail: { kind: "file_edit", path: "/w/a.ts", files: [], added: 0, removed: 0 },
        },
      },
      { type: "item.delta", at: 1, itemId: "f1", append: "x" },
    ])
    expect(itemsOf(state, "t1")[0]).toMatchObject({ detail: { kind: "file_edit", path: "/w/a.ts" } })
  })
})

describe("threadRowsOf", () => {
  it("preview 取第一条用户消息——同工作区的多个会话光靠目录名分不清", () => {
    const state = reduceAll(initial(), [
      started("a"),
      turnStarted("a", "t1"),
      { type: "item.started", at: 0, item: { id: "u1", turnId: "t1", kind: "user_message", at: 0, text: "先看看架构" } },
      { type: "item.started", at: 0, item: msg("m1", "t1", "好的") },
      { type: "item.started", at: 0, item: { id: "u2", turnId: "t1", kind: "user_message", at: 0, text: "第二条" } },
    ])
    expect(threadRowsOf(state)[0]?.preview).toBe("先看看架构")
  })

  it("还没发过消息的会话 preview 是 undefined，不是空串", () => {
    expect(threadRowsOf(reduceAll(initial(), [started("a")]))[0]?.preview).toBeUndefined()
  })

  it("顺序与 threadsOf 一致，最近创建在前", () => {
    const state = reduceAll(initial(), [started("a"), started("b")])
    expect(threadRowsOf(state).map((r) => r.thread.id)).toEqual(["b", "a"])
  })
})

describe("引擎故障通知", () => {
  const status = (s: string, detail?: string, threadId = "a"): Event => ({
    type: "engine.status",
    at: 1,
    threadId,
    status: s as "crashed",
    ...(detail === undefined ? {} : { detail }),
  })

  it("crashed / timeout 才进通知——starting/ready/exited 是正常生命周期", () => {
    const s = reduceAll(initial(), [
      status("starting"),
      status("ready"),
      status("exited"),
      status("crashed", "找不到可执行文件 codex"),
      status("timeout", "握手超时"),
    ])
    expect(s.notices.map((n) => n.text)).toEqual(["找不到可执行文件 codex", "握手超时"])
  })

  it("没有 detail 时也要有一句话，不能是空白横幅", () => {
    expect(reduceAll(initial(), [status("crashed")]).notices[0]?.text).toContain("没有描述")
  })

  it("threadId 为空串时归一成 undefined——建会话就失败时还没有会话", () => {
    expect(reduceAll(initial(), [status("crashed", "x", "")]).notices[0]?.threadId).toBeUndefined()
  })

  it("id 由序号生成，归约器是纯函数不能用时间戳或随机数", () => {
    const s = reduceAll(initial(), [status("crashed", "一"), status("crashed", "二")])
    expect(s.notices.map((n) => n.id)).toEqual(["n1", "n2"])
  })

  it("只留最近 20 条——它不是日志", () => {
    const many = Array.from({ length: 30 }, (_, i) => status("crashed", `第 ${String(i)} 条`))
    const s = reduceAll(initial(), many)
    expect(s.notices).toHaveLength(20)
    expect(s.notices[19]?.text).toBe("第 29 条")
  })
})

describe("引擎原生通知", () => {
  const notification = (key: string, message: string, at: number): Event => ({
    type: "engine.notification", at, threadId: "a", engine: "claude",
    key, message, priority: "medium", timeoutMs: 3000,
  })

  it("同一会话、引擎与 key 原地换新，新的通知仍有独立 id", () => {
    const s = reduceAll(initial(), [notification("quota", "旧", 1), notification("quota", "新", 2)])
    expect(s.notices).toEqual([expect.objectContaining({ id: "n2", text: "新", timeoutMs: 3000 })])
  })

  it("不同 key 不互相覆盖", () => {
    const s = reduceAll(initial(), [notification("one", "一", 1), notification("two", "二", 2)])
    expect(s.notices.map((notice) => notice.text)).toEqual(["一", "二"])
  })
})

describe("thread.removed", () => {
  const seeded = (): ReturnType<typeof initial> =>
    reduceAll(initial(), [
      started("a"),
      started("b"),
      turnStarted("a", "t1"),
      { type: "item.started", at: 0, item: msg("m1", "t1", "甲的内容") },
      { type: "usage.updated", at: 0, threadId: "a", engine: "claude", usage: { contextUsed: 100 } },
      {
        type: "commands.updated",
        at: 0,
        threadId: "a",
        engine: "claude",
        commands: [{ name: "old", description: "", source: "engine" }],
      },
    ])

  it("会话、顺序、item、用量一并摘掉", () => {
    const s = reduce(seeded(), { type: "thread.removed", at: 1, threadId: "a" })
    expect(threadsOf(s).map((t) => t.id)).toEqual(["b"])
    expect(itemsOf(s, "a")).toEqual([])
    expect(s.usage["a"]).toBeUndefined()
    expect(s.commands["a"]).toBeUndefined()
  })

  it("反查表也要清——留着的话一条迟到的 item.updated 会把数据写回一个不存在的会话", () => {
    const s = reduce(seeded(), { type: "thread.removed", at: 1, threadId: "a" })
    expect(s.owner["m1"]).toBeUndefined()
    expect(s.turnOwner["t1"]).toBeUndefined()
    // 迟到的更新落不进去
    const later = reduce(s, { type: "item.updated", at: 2, item: msg("m1", "t1", "复活") })
    expect(itemsOf(later, "a")).toEqual([])
  })

  it("删不存在的会话是无操作，不抛", () => {
    const s = seeded()
    expect(reduce(s, { type: "thread.removed", at: 1, threadId: "nope" })).toEqual(s)
  })

  it("不误伤别的会话", () => {
    const s = reduce(seeded(), { type: "thread.removed", at: 1, threadId: "b" })
    expect(itemsOf(s, "a")).toHaveLength(1)
    expect(s.owner["m1"]).toBe("a")
  })
})

describe("engines.available", () => {
  it("引擎清单进 state，界面据此渲染选择器", () => {
    const s = reduce(initial(), {
      type: "engines.available",
      at: 0,
      engines: [{ id: "codex", label: "Codex" }],
    })
    expect(s.engines).toEqual([{ id: "codex", label: "Codex" }])
  })

  it("再报一次是整份替换，不是追加", () => {
    const first = reduce(initial(), {
      type: "engines.available",
      at: 0,
      engines: [{ id: "a", label: "A" }],
    })
    const second = reduce(first, {
      type: "engines.available",
      at: 1,
      engines: [{ id: "b", label: "B" }],
    })
    expect(second.engines).toEqual([{ id: "b", label: "B" }])
  })
})

describe("重复的 item.started 不长出两条", () => {
  it("**全量重建拼的是两份来源，重叠是必然的**——同一条 item 来两次要替换而不是追加", () => {
    const first = msg("i1", "t1", "第一次")
    const again = { ...msg("i1", "t1", "补回来的那一份"), complete: true }
    const s = reduceAll(initial(), [
      started("a"),
      turnStarted("a", "t1"),
      { type: "item.started", at: 0, item: first },
      { type: "item.started", at: 1, item: again },
    ])
    const items = itemsOf(s, "a")
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: "i1", text: "补回来的那一份", complete: true })
  })

  it("不同 id 照常各占一条", () => {
    const s = reduceAll(initial(), [
      started("a"),
      turnStarted("a", "t1"),
      { type: "item.started", at: 0, item: msg("i1", "t1", "一") },
      { type: "item.started", at: 0, item: msg("i2", "t1", "二") },
    ])
    expect(itemsOf(s, "a")).toHaveLength(2)
  })

  it("重复之后 delta 仍然落在同一条上", () => {
    const s = reduceAll(initial(), [
      started("a"),
      turnStarted("a", "t1"),
      { type: "item.started", at: 0, item: msg("i1", "t1", "起") },
      { type: "item.started", at: 0, item: msg("i1", "t1", "起") },
      { type: "item.delta", at: 0, itemId: "i1", append: "步" },
    ])
    const items = itemsOf(s, "a")
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ text: "起步" })
  })
})

describe("补一条会话的历史", () => {
  /** 一条会话，历史里三条消息。 */
  const history: Event[] = [
    started("a"),
    turnStarted("a", "u1"),
    { type: "item.started", at: 1, item: msg("i1", "u1", "第一条") },
    { type: "item.started", at: 2, item: msg("i2", "u1", "第二条") },
    { type: "item.started", at: 3, item: msg("i3", "u1", "第三条") },
  ]

  it("空状态下就是照着历史铺开", () => {
    const s = reduceHistory(initial(), "a", history)
    expect(itemsOf(s, "a").map((i) => i.id)).toEqual(["i1", "i2", "i3"])
  })

  it("**已经在直播的那几条不会把历史挤到后面去**——这是补历史最容易出的错", () => {
    // 人在列表页，这条会话照样在跑：最新那条先从事件流上过来了
    const live = reduceAll(initial(), [
      started("a"),
      turnStarted("a", "u1"),
      { type: "item.started", at: 3, item: msg("i3", "u1", "第三条") },
    ])
    expect(itemsOf(live, "a").map((i) => i.id)).toEqual(["i3"])
    // 现在打开它，宿主把整份历史补过来
    const s = reduceHistory(live, "a", history)
    expect(itemsOf(s, "a").map((i) => i.id)).toEqual(["i1", "i2", "i3"])
  })

  it("**只清这一条的条目**，别的会话不受影响", () => {
    const both = reduceAll(initial(), [
      started("b"),
      turnStarted("b", "u2"),
      { type: "item.started", at: 1, item: msg("x1", "u2", "别条的") },
      ...history,
    ])
    const s = reduceHistory(both, "a", history)
    expect(itemsOf(s, "b").map((i) => i.id)).toEqual(["x1"])
  })

  it("补完之后新来的照常追加在后面", () => {
    const s = reduceHistory(initial(), "a", history)
    const later = reduceAll(s, [{ type: "item.started", at: 4, item: msg("i4", "u1", "第四条") }])
    expect(itemsOf(later, "a").map((i) => i.id)).toEqual(["i1", "i2", "i3", "i4"])
  })
})

describe("出口合并：省的是账本的保留窗口，不是字节", () => {
  const delta = (id: string, s: string): Event => ({ type: "item.delta", at: 0, itemId: id, append: s })

  it("**一次构建的输出合成一条**——`rpc.ts` 的 feed 把一个 stdout chunk 按行在同一个 tick 里全派发", () => {
    const batch = Array.from({ length: 500 }, (_, i) => delta("cmd", `第 ${String(i)} 行\n`))
    const merged = coalesce(batch)
    expect(merged).toHaveLength(1)
    // 内容一个字都不能少——账本里少一段就是界面上少一段
    const all = (merged[0] as { append: string }).append
    expect(all.startsWith("第 0 行")).toBe(true)
    expect(all.endsWith("第 499 行\n")).toBe(true)
  })

  it("**合并前后归约结果完全一样**——这是它敢合的全部依据", () => {
    const batch = [delta("i", "一"), delta("i", "二"), delta("i", "三")]
    const base = reduceAll(initial(), [started("a"), turnStarted("a", "u"), { type: "item.started", at: 0, item: msg("i", "u", "") }])
    const one = reduceAll(base, batch)
    const other = reduceAll(base, coalesce(batch))
    expect(itemsOf(other, "a")).toEqual(itemsOf(one, "a"))
  })

  it("**中间夹了别的就断开**——跨过去合并会改变先后关系，而顺序是这套东西唯一的正确性来源", () => {
    const batch = [delta("i", "一"), delta("别的", "x"), delta("i", "二")]
    expect(coalesce(batch)).toHaveLength(3)
  })

  it("两条不同 item 的 delta 不会互相吞掉", () => {
    expect(coalesce([delta("a", "1"), delta("b", "2")])).toHaveLength(2)
  })
})
