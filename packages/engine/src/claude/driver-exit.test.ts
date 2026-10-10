import { describe, expect, it, vi } from "vitest"
import type { Event } from "@switchback/protocol"

// 进程启动后很快死掉：消息流抛错收尾，此后再没人读输入
const sdk = vi.hoisted(() => ({ fail: undefined as undefined | ((error: Error) => void) }))
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: () => {
    const dead = new Promise<never>((_resolve, reject) => {
      sdk.fail = reject
    })
    const target = {
      async *[Symbol.asyncIterator]() {
        yield { type: "system", subtype: "init", session_id: "native-1" }
        await dead
      },
      interrupt: () => Promise.reject(new Error("Cannot write to terminated process")),
    }
    return new Proxy(target, {
      get: (object, key) => (key in object ? (object as Record<PropertyKey, unknown>)[key] : () => Promise.resolve(undefined)),
    })
  },
}))

const { createClaudeDriver } = await import("./driver.js")
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe("Claude 进程死了", () => {
  it("报一次 onExit；之后的话明确失败，不被没人读的队列吞掉", async () => {
    const events: Event[] = []
    const exits: string[] = []
    const session = await createClaudeDriver().start({
      threadId: "th-1", cwd: "/w", home: "/h", trust: "auto-edit", memory: () => [],
      emit: (event) => events.push(event),
      askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
      onExit: (detail) => exits.push(detail),
    })
    await session.prompt("第一句", "t1")
    await settle()
    sdk.fail?.(new Error("Claude Code process terminated by signal SIGKILL"))
    await settle()
    await settle()
    expect(exits).toEqual(["Claude Code 进程已退出：Claude Code process terminated by signal SIGKILL"])
    expect(events).toContainEqual(expect.objectContaining({ type: "turn.completed", turnId: "t1", status: "failed" }))

    await expect(session.prompt("第二句", "t2")).rejects.toThrow("Claude 输入流已经关闭")
    expect(events.filter((event) => event.type === "turn.completed" && event.turnId === "t2"))
      .toEqual([expect.objectContaining({ status: "failed" })])
    await session.dispose()
    expect(exits).toHaveLength(1)
  })
})
