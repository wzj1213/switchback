import { describe, expect, it, vi } from "vitest"

// 记下 CLI 那头先收到什么：送进去的话，还是中断
const sdk = vi.hoisted(() => ({ order: [] as string[], sent: [] as string[] }))
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ prompt }: { prompt: AsyncIterable<{ uuid?: string }> }) => {
    void (async () => {
      for await (const message of prompt) {
        sdk.order.push("话")
        if (message.uuid !== undefined) sdk.sent.push(message.uuid)
      }
    })()
    const target = {
      async *[Symbol.asyncIterator]() {
        yield { type: "system", subtype: "init", session_id: "native-1" }
        await new Promise<never>(() => undefined)
      },
      interrupt: () => {
        sdk.order.push("中断")
        return Promise.resolve({ still_queued: [...sdk.sent] })
      },
    }
    return new Proxy(target, {
      get: (object, key) => (key in object ? (object as Record<PropertyKey, unknown>)[key] : () => Promise.resolve(undefined)),
    })
  },
}))

const { createClaudeDriver } = await import("./driver.js")

describe("刚按发送就按停止", () => {
  it("中断排在那句话后面送到，回执才点得到它", async () => {
    const session = await createClaudeDriver().start({
      threadId: "th-1", cwd: "/w", home: "/h", trust: "auto-edit", memory: () => [],
      emit: () => undefined,
      askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    const sending = session.prompt("第一句", "t1")
    await session.interrupt()
    await sending
    expect(sdk.order).toEqual(["话", "中断"])
    expect(sdk.sent).toHaveLength(1)
    void session.dispose()
  })
})
