import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import { createTurnRef, runMessageLoop } from "./loop.js"

function request(events: Event[]): StartRequest {
  return {
    threadId: "thread-1", cwd: "/work", home: "/home/dev", trust: "auto-edit", memory: () => [],
    emit: (event) => events.push(event),
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
    askQuestion: () => Promise.resolve({ dismissed: true }),
  }
}

function toolFrames(prefix: readonly unknown[]): readonly unknown[] {
  return [
    { type: "assistant", message: { content: [
      { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "sudo -n true" } },
    ] } },
    ...prefix,
    { type: "user", message: { content: [
      { type: "tool_result", tool_use_id: "tool-1", content: "permission denied", is_error: true },
    ] } },
    { type: "result", subtype: "success", is_error: false,
      permission_denials: [{ tool_name: "Bash", tool_use_id: "tool-1", tool_input: {} }] },
  ]
}

function stream(messages: readonly unknown[]): never {
  return { async *[Symbol.asyncIterator]() { for (const message of messages) yield message } } as never
}

async function statuses(prefix: readonly unknown[]): Promise<readonly string[]> {
  const events: Event[] = []
  const ref = createTurnRef(() => undefined)
  ref.current = "turn-1"
  await runMessageLoop(stream(toolFrames(prefix)), request(events), ref, () => "auto-edit")
  return events.flatMap((event) =>
    event.type === "item.updated" && event.item.kind === "tool_call" && event.item.id === "tool-1"
      ? [event.item.status]
      : [])
}

describe("Claude 消息循环的权限拒绝", () => {
  it("自动拒绝从 advisory 起就保持 denied，不被错误结果和收工覆盖", async () => {
    await expect(statuses([{
      type: "system", subtype: "permission_denied", tool_use_id: "tool-1",
      tool_name: "Bash", message: "permission denied", decision_reason_type: "mode",
    }])).resolves.toEqual(["denied", "denied"])
  })

  it("宿主拒绝没有 advisory 时，最终权威清单仍把 failed 改成 denied", async () => {
    await expect(statuses([])).resolves.toEqual(["failed", "denied"])
  })
})
