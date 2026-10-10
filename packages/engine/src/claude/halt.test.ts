import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { haltTurn } from "./halt.js"
import { createTurnRef, runMessageLoop, type TurnRef } from "./loop.js"

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function request(events: Event[]): StartRequest {
  return {
    threadId: "thread-halt", cwd: "/work", home: "/home/dev", trust: "auto-edit",
    memory: () => [], emit: (event) => events.push(event),
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
    askQuestion: () => Promise.resolve({ dismissed: true }),
  }
}

/** 一串回执依次回；每条消息之间让出一拍，模拟 CLI 那头一条条地来。 */
function handleOf(receipts: readonly (readonly string[])[], messages: readonly unknown[]) {
  const calls: number[] = []
  const handle = {
    interrupt: () => {
      calls.push(calls.length)
      return Promise.resolve({ still_queued: [...(receipts[calls.length - 1] ?? [])] })
    },
    async *[Symbol.asyncIterator]() {
      for (const message of messages) {
        await settle()
        yield message
      }
    },
  }
  return { handle, calls }
}

const assistant = (text: string): unknown => ({
  type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text }] },
})
const stopped = { type: "result", subtype: "error_during_execution", is_error: false }

function turnRef(sent: readonly string[], pendingSteers = 0): TurnRef {
  const ref = createTurnRef(() => undefined)
  ref.current = "t1"
  ref.pendingSteers = pendingSteers
  for (const id of sent) ref.halt.sent.add(id)
  return ref
}

async function run(ref: TurnRef, receipts: readonly (readonly string[])[], messages: readonly unknown[]) {
  const events: Event[] = []
  const { handle, calls } = handleOf(receipts, messages)
  await haltTurn(handle as never, ref)
  const marked = ref.halt.turn
  await runMessageLoop(handle as never, request(events), ref, () => "auto-edit")
  const ends = events.flatMap((event) => event.type === "turn.completed" ? [event.status] : [])
  return { marked, interrupts: calls.length, ends }
}

describe("停止：中断够不着的那条，跑起来再停一次", () => {
  const cases = [
    {
      name: "这句话刚出队还没开跑：回执点名，跑起来就再停，停住为止",
      ref: () => turnRef(["p"]),
      receipts: [["p"], []],
      messages: [assistant("开始了"), assistant("还在跑"), stopped],
      want: { marked: "t1", interrupts: 2, ends: ["interrupted"] },
    },
    {
      name: "排着一条插话：被打断那段的 result 不算跑起来，插话那段一冒头就停",
      ref: () => turnRef(["p", "s"], 1),
      receipts: [["s"], []],
      messages: [stopped, assistant("插话那段"), stopped],
      want: { marked: "t1", interrupts: 2, ends: ["interrupted"] },
    },
    {
      name: "回执没点这一轮的消息：正在跑的那段已经停了，不再追",
      ref: () => turnRef(["p"]),
      receipts: [["别人排的"]],
      messages: [assistant("收尾"), stopped],
      want: { marked: undefined, interrupts: 1, ends: ["interrupted"] },
    },
    {
      name: "不报回执的旧 CLI：只停正在跑的那段",
      ref: () => turnRef(["p"]),
      receipts: [],
      messages: [assistant("收尾"), stopped],
      want: { marked: undefined, interrupts: 1, ends: ["interrupted"] },
    },
  ]
  for (const one of cases) {
    it(one.name, async () => {
      expect(await run(one.ref(), one.receipts, one.messages)).toEqual(one.want)
    })
  }

  it("回执回来时这一轮已经收了：不记在下一轮头上", async () => {
    const ref = turnRef(["p"])
    const pending = haltTurn({
      interrupt: () => {
        ref.current = undefined
        return Promise.resolve({ still_queued: ["p"] })
      },
    } as never, ref)
    await pending
    expect(ref.halt.turn).toBeUndefined()
  })
})
