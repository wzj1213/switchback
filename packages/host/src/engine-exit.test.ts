import { describe, expect, it } from "vitest"
import type { Event, Thread } from "@switchback/protocol"
import { create, items, setupTwoEngines } from "./host-fixture.js"

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function lastThread(events: readonly Event[]): Thread | undefined {
  return events.flatMap((event) => (event.type === "thread.updated" ? [event.thread] : [])).at(-1)
}

async function started(rig: ReturnType<typeof setupTwoEngines>): Promise<string> {
  await rig.host.dispatch(create)
  const id = rig.events.find((event) => event.type === "thread.started")?.thread.id ?? ""
  await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "第一句" })
  rig.sessions[0]?.handle("h-1")
  return id
}

describe("引擎背后的进程或实时流没了", () => {
  it("摘成历史会话；下一句话用原来的句柄重新拉起，而不是交给死进程", async () => {
    const rig = setupTwoEngines()
    const id = await started(rig)
    rig.sessions[0]?.emit({ type: "turn.completed", at: 1, turnId: rig.sessions[0].prompts[0]?.turnId ?? "", status: "completed" })
    rig.sessions[0]?.exit("codex 进程已退出（信号 SIGKILL）")
    await tick()
    expect(rig.host.live()).toEqual([])
    expect(lastThread(rig.events)).toMatchObject({ id, detached: true, status: "idle", engineHandle: "h-1" })
    expect(rig.sessions[0]?.disposed).toBe(true)

    await rig.host.dispatch({ type: "thread.prompt", threadId: id, text: "第二句" })
    expect(rig.sessions).toHaveLength(2)
    expect(rig.sessions[1]?.resume).toBe("h-1")
    expect(rig.sessions[1]?.prompts.map((prompt) => prompt.text)).toEqual(["第二句"])
  })

  it("轮次还没收工就没了：宿主替它收成失败，原因照引擎自己的话", async () => {
    const rig = setupTwoEngines()
    const id = await started(rig)
    rig.sessions[0]?.exit("Claude Code 进程已退出：terminated by signal SIGKILL")
    await tick()
    expect(rig.events.filter((event) => event.type === "turn.completed").at(-1)).toMatchObject({
      status: "failed", error: "Claude Code 进程已退出：terminated by signal SIGKILL",
    })
    expect(items(rig.events).filter((item) => item.kind === "error").map((item) => item.kind === "error" && item.message))
      .toEqual(["Claude Code 进程已退出：terminated by signal SIGKILL"])
    expect(lastThread(rig.events)).toMatchObject({ id, detached: true })
  })

  it("宿主自己换掉的旧进程退出不算：新引擎照常活着", async () => {
    const rig = setupTwoEngines()
    const id = await started(rig)
    rig.sessions[0]?.emit({ type: "turn.completed", at: 1, turnId: rig.sessions[0].prompts[0]?.turnId ?? "", status: "completed" })
    await rig.host.dispatch({ type: "thread.handoff", threadId: id, to: "other" })
    await rig.host.dispatch({ type: "thread.switchNow", threadId: id })
    rig.sessions[0]?.exit("codex 进程已退出（code 0）")
    await tick()
    expect(rig.host.live().map((thread) => [thread.engine, thread.detached])).toEqual([["other", undefined]])
  })
})
