import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { Event, Lane } from "@switchback/protocol"
import { createJournal } from "@switchback/journal"
import { initial, lanesOf, reduceAll } from "@switchback/store"
import { createHost } from "./host.js"
import { fakeDriver, create } from "./host-fixture.js"

/**
 * 端到端：**驱动发一条 lane → 宿主路由 → 真磁盘 → 读回重放 → store**。
 *
 * 这一段是之前谁都没测过的接缝。两头各自有测试：
 * 引擎那边 `claude/workflow.test.ts` 拿 2026-08-19 那一帧真数据钉死了翻译；
 * 渲染那边 `group.test.ts` 钉死了插行。中间这几层只在类型上对得上。
 *
 * **用真的 journal 而不是内存数组**：这条路上最容易错的正是「它到底落没落盘」——
 * `codec.ts` 的 SKIP 是黑名单，新事件默认落，但那是**默认**，不是被验证过的事实。
 * 「⌘R 之后旁路还在」是发布说明里写给用户的一句话，得有东西钉着它。
 */
describe("旁路从驱动到磁盘再回到界面", () => {
  const cleanups: (() => Promise<void>)[] = []
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  })

  /** 引擎侧原样的一条：id 是它自己的 `task_id`，形状同 `toLane` 的产物。 */
  const native: Lane = {
    id: "w4zk4icbn",
    threadId: "will-be-overwritten",
    kind: "activity",
    title: "review-echo",
    status: "running",
    at: 100,
    handle: "w4zk4icbn",
    progress: {
      nodes: [
        { id: "p1", label: "Read", state: "done" },
        { id: "a1", parent: "p1", label: "read:alpha.txt", state: "done", detail: "红", tokens: 11031 },
      ],
    },
  }

  async function rig(): Promise<{ events: Event[]; read: () => Promise<readonly Event[]>; threadId: string; emit: (e: Event) => void }> {
    const dir = await mkdtemp(join(tmpdir(), "switchback-lane-"))
    const journal = createJournal({ dir })
    // 宿主写日志是故意不阻塞事件出口的；清理必须先等队列排空，否则 rm 会和 append 竞速。
    cleanups.push(async () => {
      await journal.flush()
      await rm(dir, { recursive: true, force: true })
    })
    const { driver, session } = fakeDriver()
    const events: Event[] = []
    const counter = { n: 0 }
    const host = createHost({
      drivers: { fake: driver },
      home: "/home/dev",
      emit: (e) => events.push(e),
      newId: (prefix) => `${prefix}-${String((counter.n += 1))}`,
      now: () => 0,
      journal,
    })
    await host.dispatch(create)
    const threadId = events.find((e) => e.type === "thread.started")?.thread.id ?? ""
    // 第一句话之后会话才转正、才落盘（`Ctx.uncommitted`）
    await host.dispatch({ type: "thread.prompt", threadId, text: "起一批" })
    return {
      events,
      threadId,
      emit: session().emit,
      read: async () => {
        await journal.flush()
        return journal.read(threadId)
      },
    }
  }

  it("**驱动铸的 id 在宿主重铸**——两家引擎都报 `w4zk4icbn` 时不会互相覆盖", async () => {
    const { events, emit, threadId } = await rig()
    emit({ type: "lane.updated", at: 100, threadId, lane: native })
    const out = events.filter((e) => e.type === "lane.updated")
    expect(out).toHaveLength(1)
    expect(out[0]?.type === "lane.updated" ? out[0].lane.id : "").toMatch(/^ln-/)
  })

  it("**真的落盘了**——`codec.ts` 的 SKIP 是黑名单，但「默认会落」不等于验证过", async () => {
    const { emit, read, threadId } = await rig()
    emit({ type: "lane.updated", at: 100, threadId, lane: native })
    const stored = await read()
    expect(stored.filter((e) => e.type === "lane.updated")).toHaveLength(1)
  })

  it("**⌘R 之后旁路还在**：只读磁盘重放一遍，树一个节点都不少", async () => {
    const { emit, read, threadId } = await rig()
    emit({ type: "lane.updated", at: 100, threadId, lane: native })
    emit({
      // **lane 自己的 `at` 也换成 200**：驱动每帧都填当前时间（`toLane` 就是这么做的），
      // 只改事件那个 `at` 的话这条断言是空的——扰动测试当场就抓到了
      type: "lane.updated", at: 200, threadId,
      lane: { ...native, at: 200, status: "done", progress: { nodes: [
        { id: "p1", label: "Read", state: "done" },
        { id: "a1", parent: "p1", label: "read:alpha.txt", state: "done", detail: "红", tokens: 11031 },
        { id: "p2", label: "Verify", state: "running" },
      ] } },
    })
    const replayed = reduceAll(initial(), await read())
    const lanes = lanesOf(replayed, threadId)
    expect(lanes).toHaveLength(1)
    expect(lanes[0]).toMatchObject({ title: "review-echo", status: "done" })
    expect(lanes[0]?.progress?.nodes).toHaveLength(3)
    // **出生时刻不跟着更新走**：第二条报的是 200，回放出来仍是 100，
    // 否则界面按 `at` 插行，卡片会在对话里一路往下爬
    expect(lanes[0]?.at).toBe(100)
  })

  it("同一条 lane 报两遍只留一条——upsert，不是追加", async () => {
    const { emit, read, threadId } = await rig()
    emit({ type: "lane.updated", at: 100, threadId, lane: native })
    emit({ type: "lane.updated", at: 200, threadId, lane: { ...native, title: "改过了" } })
    const lanes = lanesOf(reduceAll(initial(), await read()), threadId)
    expect(lanes).toHaveLength(1)
    expect(lanes[0]?.title).toBe("改过了")
  })

  it("删掉会话之后磁盘上不留旁路——lane 里可能挂着一整棵树", async () => {
    const { emit, read, threadId } = await rig()
    emit({ type: "lane.updated", at: 100, threadId, lane: native })
    const replayed = reduceAll(initial(), await read())
    const gone = reduceAll(replayed, [{ type: "thread.removed", at: 300, threadId }])
    expect(gone.lanes[threadId]).toBeUndefined()
  })
})
