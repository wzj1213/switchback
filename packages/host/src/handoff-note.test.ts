import { describe, expect, it } from "vitest"
import type { Event, Thread } from "@omni/protocol"
import { create, items, setupTwoEngines } from "./host-fixture.js"
import { isFirstAfterSwitch } from "./handoff-note.js"

const base = { engine: "b", segments: [] } as unknown as Thread

describe("isFirstAfterSwitch", () => {
  const seg = (engine: string, profile?: string): NonNullable<Thread["segments"]>[number] => ({
    engine, handle: `h-${engine}`, startedAt: 0, ...(profile === undefined ? {} : { profile }),
  })
  const cases: readonly { name: string; thread: Partial<Thread>; want: boolean }[] = [
    { name: "一段都没有（第一家还没说过话）", thread: { segments: [] }, want: false },
    { name: "没有 segments 字段（旧记录）", thread: { segments: undefined }, want: false },
    { name: "最后一段就是当前这家", thread: { segments: [seg("a"), seg("b")] }, want: false },
    { name: "最后一段是上一家", thread: { segments: [seg("a")] }, want: true },
    { name: "换出去又换回来：最后一段是别家", thread: { engine: "a", segments: [seg("a"), seg("b")] }, want: true },
    { name: "同一家换了 profile", thread: { engineProfile: "p2", segments: [seg("b", "p1")] }, want: true },
    { name: "同一家同一 profile", thread: { engineProfile: "p1", segments: [seg("b", "p1")] }, want: false },
  ]
  for (const c of cases) {
    it(c.name, () => {
      expect(isFirstAfterSwitch({ ...base, ...c.thread } as Thread)).toBe(c.want)
    })
  }
})

type Rig = ReturnType<typeof setupTwoEngines>

function threadIdOf(rig: Rig): string {
  const born = rig.events.find((e) => e.type === "thread.started")
  return born?.type === "thread.started" ? born.thread.id : ""
}

/** 让第 `index` 家的最近一轮收工；`handle` 给了就先报句柄（分段要有句柄才落）。 */
function finish(rig: Rig, index: number, handle?: string, status: "completed" | "failed" = "completed"): void {
  const session = rig.sessions[index]
  if (handle !== undefined) session?.handle(handle)
  const turnId = session?.prompts[session.prompts.length - 1]?.turnId ?? ""
  session?.emit({ type: "turn.completed", at: 0, turnId, status })
}

/** 第一家说一句并收工，再点下拉换到 other——还没说话。 */
async function workedThenPicked(rig: Rig): Promise<string> {
  await rig.host.dispatch(create)
  const threadId = threadIdOf(rig)
  await rig.host.dispatch({ type: "thread.prompt", threadId, text: "把 X 改成 Y" })
  finish(rig, 0, "native-a")
  await rig.host.dispatch({ type: "thread.handoff", threadId, to: "other" })
  return threadId
}

const NOTE = "<omni-handoff>此前由 fake 跑了第 1 轮</omni-handoff>"

function userTexts(events: Event[]): readonly { text: string; origin?: unknown }[] {
  return items(events)
    .filter((item) => item.kind === "user_message")
    .map((item) => ({ text: item.text, ...(item.origin === undefined ? {} : { origin: item.origin }) }))
}

describe("换引擎自动交接", () => {
  it("换家后第一句：说明在前、用户那句在后，一起送给新那家；转录区先记说明", async () => {
    const asked: Thread[] = []
    const rig = setupTwoEngines({
      handoffBrief: (thread) => {
        asked.push(thread)
        return Promise.resolve(NOTE)
      },
    })
    const threadId = await workedThenPicked(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId, text: "接着弄" })
    expect(rig.sessions[1]?.prompts.map((p) => p.text)).toEqual([`${NOTE}\n\n接着弄`])
    expect(userTexts(rig.events)).toEqual([
      { text: "把 X 改成 Y" },
      { text: NOTE, origin: "handoff" },
      { text: "接着弄" },
    ])
    // 问的时候已经切过去了：说明要写「接下来由谁接手」
    expect(asked.map((thread) => thread.engine)).toEqual(["other"])
  })

  it("新那家落下自己那一段之后，下一句不再附", async () => {
    const rig = setupTwoEngines({ handoffBrief: () => Promise.resolve(NOTE) })
    const threadId = await workedThenPicked(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId, text: "接着弄" })
    finish(rig, 1, "native-b")
    await rig.host.dispatch({ type: "thread.prompt", threadId, text: "再改一处" })
    expect(rig.sessions[1]?.prompts.map((p) => p.text)).toEqual([`${NOTE}\n\n接着弄`, "再改一处"])
  })

  it("新那家第一轮没拿到句柄就失败了：它手里没有接得住的会话，下一句再附一次", async () => {
    const rig = setupTwoEngines({ handoffBrief: () => Promise.resolve(NOTE) })
    const threadId = await workedThenPicked(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId, text: "接着弄" })
    finish(rig, 1, undefined, "failed")
    await rig.host.dispatch({ type: "thread.prompt", threadId, text: "再试一次" })
    expect(rig.sessions[1]?.prompts.map((p) => p.text)).toEqual([`${NOTE}\n\n接着弄`, `${NOTE}\n\n再试一次`])
  })

  it("排在队里的那句被 drain 时才兑现切换：一样附说明", async () => {
    const rig = setupTwoEngines({ handoffBrief: () => Promise.resolve(NOTE) })
    await rig.host.dispatch(create)
    const threadId = threadIdOf(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId, text: "把 X 改成 Y" })
    rig.sessions[0]?.handle("native-a")
    // 上一轮还在跑时换家、再说一句：这句排队，收工后由 drain 发出，那时才切
    await rig.host.dispatch({ type: "thread.handoff", threadId, to: "other" })
    await rig.host.dispatch({ type: "thread.prompt", threadId, text: "接着弄" })
    finish(rig, 0)
    await expect.poll(() => rig.sessions[1]?.prompts.length ?? 0).toBe(1)
    expect(rig.sessions[1]?.prompts.map((p) => p.text)).toEqual([`${NOTE}\n\n接着弄`])
  })

  const plain: readonly { name: string; brief?: () => Promise<string | undefined> }[] = [
    { name: "没接交接说明（测试、无盘环境）" },
    { name: "用户关了开关（依赖返回 undefined）", brief: () => Promise.resolve(undefined) },
    { name: "只给了空白", brief: () => Promise.resolve("  \n") },
    { name: "写说明时读盘失败", brief: () => Promise.reject(new Error("EACCES")) },
  ]
  for (const c of plain) {
    it(`${c.name}：照旧只发用户那句，不记说明`, async () => {
      const rig = setupTwoEngines(c.brief === undefined ? {} : { handoffBrief: c.brief })
      const threadId = await workedThenPicked(rig)
      await rig.host.dispatch({ type: "thread.prompt", threadId, text: "接着弄" })
      expect(rig.sessions[1]?.prompts.map((p) => p.text)).toEqual(["接着弄"])
      expect(userTexts(rig.events).some((m) => m.origin === "handoff")).toBe(false)
    })
  }

  it("同一家连着说：一次都不问", async () => {
    let asked = 0
    const rig = setupTwoEngines({
      handoffBrief: () => {
        asked += 1
        return Promise.resolve(NOTE)
      },
    })
    await rig.host.dispatch(create)
    const threadId = threadIdOf(rig)
    await rig.host.dispatch({ type: "thread.prompt", threadId, text: "一" })
    finish(rig, 0, "native-a")
    await rig.host.dispatch({ type: "thread.prompt", threadId, text: "二" })
    expect(asked).toBe(0)
    expect(rig.sessions[0]?.prompts.map((p) => p.text)).toEqual(["一", "二"])
  })
})
