import { describe, expect, it } from "vitest"
import { initial, itemsOf, reduceAll } from "@switchback/store"
import type { Event } from "@switchback/protocol"
import { create, setupTwoEngines } from "./host-fixture.js"

const edit = (turnId: string, path: string): Event => ({
  type: "item.started",
  at: 0,
  item: {
    id: "c1",
    turnId,
    at: 0,
    kind: "tool_call",
    tool: "edit",
    status: "ok",
    detail: {
      kind: "file_edit",
      path,
      files: [{ path, kind: "update", added: 1, removed: 0 }],
      added: 1,
      removed: 0,
    },
  },
})

describe("跨引擎接力的文件记录", () => {
  it("两家都用原生 c1 时保住两条编辑，切换启动状态先于新轮次", async () => {
    const rig = setupTwoEngines()
    await rig.host.dispatch(create)
    const threadId = rig.events.find((event) => event.type === "thread.started")?.thread.id ?? ""

    await rig.host.dispatch({ type: "thread.prompt", threadId, text: "第一轮" })
    const firstTurn = rig.sessions[0]?.prompts[0]?.turnId ?? ""
    rig.sessions[0]?.emit(edit(firstTurn, "/w/old.ts"))
    rig.sessions[0]?.emit({
      type: "turn.completed",
      at: 1,
      turnId: firstTurn,
      status: "completed",
    })

    await rig.host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    const before = rig.events.length
    await rig.host.dispatch({ type: "thread.prompt", threadId, text: "第二轮" })
    const secondTurn = rig.sessions[1]?.prompts[0]?.turnId ?? ""
    rig.sessions[1]?.emit(edit(secondTurn, "/w/new.ts"))

    const after = rig.events.slice(before)
    const switching = after.findIndex(
      (event) => event.type === "thread.updated" && event.thread.status === "starting",
    )
    const started = after.findIndex(
      (event) => event.type === "turn.started" && event.turn.engine === "other",
    )
    expect(switching).toBeGreaterThanOrEqual(0)
    expect(started).toBeGreaterThan(switching)

    const state = reduceAll(initial(), rig.events)
    const edits = itemsOf(state, threadId).filter(
      (item) => item.kind === "tool_call" && item.detail.kind === "file_edit",
    )
    expect(
      edits.flatMap((item) =>
        item.kind === "tool_call" && item.detail.kind === "file_edit" ? [item.detail.path] : [],
      ),
    ).toEqual(["/w/old.ts", "/w/new.ts"])
    expect(new Set(edits.map((item) => item.id)).size).toBe(2)
  })
})
