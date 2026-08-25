import { mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createAcpDriver } from "./driver.js"
import { grokPromptMeta } from "./grok-hooks.js"

const TURN = "omni-audit-turn"

function echoedPromptId(method: string, params: unknown): string | undefined {
  const raw = params as {
    promptId?: unknown
    _meta?: { promptId?: unknown }
    params?: { _meta?: { promptId?: unknown } }
  } | undefined
  const value = method.endsWith("session/prompt_complete")
    ? raw?.promptId
    : raw?._meta?.promptId ?? raw?.params?._meta?.promptId
  return typeof value === "string" ? value : undefined
}

function shapeOf(method: string, params: unknown): string {
  const raw = typeof params === "object" && params !== null ? params as Record<string, unknown> : {}
  const nested = typeof raw["params"] === "object" && raw["params"] !== null
    ? Object.keys(raw["params"] as Record<string, unknown>).sort()
    : []
  return `${method}:${Object.keys(raw).sort().join(",")}:${nested.join(",")}`
}

function waitForTurn(events: readonly Event[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (!events.some((event) => event.type === "turn.completed")) return
      clearInterval(timer)
      clearTimeout(deadline)
      resolve()
    }, 100)
    const deadline = setTimeout(() => {
      clearInterval(timer)
      reject(new Error("等待 Grok 完成 promptId 回显真测超时"))
    }, 120_000)
  })
}

describe("Grok promptId 关联（真跑）", () => {
  it("把宿主 turn id 放进原生扩展位后，Grok 在原生完成事件上原样返回", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "omni-grok-prompt-meta-"))
    const events: Event[] = []
    const echoed: string[] = []
    const shapes = new Set<string>()
    const driver = createAcpDriver({
      id: "grok",
      command: process.env["OMNI_ACP_COMMAND"] ?? "grok",
      args: (process.env["OMNI_ACP_ARGS"] ?? "agent stdio").split(" ").filter(Boolean),
      promptMeta: grokPromptMeta,
      notification: (method, params) => {
        shapes.add(shapeOf(method, params))
        const promptId = echoedPromptId(method, params)
        if (promptId !== undefined) echoed.push(promptId)
        return undefined
      },
    })
    const session = await driver.start({
      threadId: "live-grok-prompt-meta", cwd, trust: "read-only", home: homedir(), memory: () => [],
      emit: (event) => events.push(event),
      askUser: () => Promise.resolve({ allow: false, remember: "once" }),
      askQuestion: () => Promise.resolve({ dismissed: true }),
    })
    try {
      await session.prompt("Reply with exactly OK.", TURN)
      await waitForTurn(events)
      expect(echoed, [...shapes].join("\n")).toContain(TURN)
    } finally {
      await session.dispose()
    }
  }, 180_000)
})
