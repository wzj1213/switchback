import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { createTurnRef, runMessageLoop } from "./loop.js"
import { emitPluginInstall } from "./plugin-install.js"

function stream(messages: readonly unknown[]): never {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message
    },
  } as never
}

function request(events: Event[]): StartRequest {
  return {
    threadId: "thread-1", cwd: "/work", home: "/home/dev", trust: "auto-edit", memory: () => [],
    emit: (event) => events.push(event),
    askUser: () => Promise.resolve({ allow: false, remember: "once" }),
    askQuestion: () => Promise.resolve({ dismissed: true }),
  }
}

describe("Claude 原生插件同步进度", () => {
  it.each([
    [
      { status: "started" },
      { key: "plugin-install", message: "Claude 正在同步配置中的插件…", priority: "medium" },
    ],
    [
      { status: "installed", name: "company-marketplace" },
      { key: "plugin-install:company-marketplace", message: "Claude 已同步插件来源：company-marketplace", priority: "low", timeoutMs: 5000 },
    ],
    [
      { status: "failed", name: "company-marketplace", error: "network unavailable" },
      { key: "plugin-install:company-marketplace", message: "Claude 插件来源同步失败：company-marketplace — network unavailable", priority: "immediate", color: "error" },
    ],
    [
      { status: "completed" },
      { key: "plugin-install", message: "Claude 插件同步流程已结束", priority: "low", timeoutMs: 5000 },
    ],
  ])("翻译公开状态 %#", (message, expected) => {
    const events: Event[] = []
    emitPluginInstall(message, { threadId: "thread-1", at: 42, emit: (event) => events.push(event) })
    expect(events[0]).toMatchObject({
      type: "engine.notification", at: 42, threadId: "thread-1", engine: "claude", ...expected,
    })
  })

  it.each([
    { status: "installed", name: "" },
    { status: "unknown" },
  ])("坏载荷静默略过：%o", (message) => {
    const events: Event[] = []
    emitPluginInstall(message, { threadId: "thread-1", at: 1, emit: (event) => events.push(event) })
    expect(events).toEqual([])
  })

  it("消息循环在首轮之前也显示失败，不依赖 transcript", async () => {
    const events: Event[] = []
    await runMessageLoop(stream([{
      type: "system", subtype: "plugin_install", status: "failed", name: "team", error: "403",
    }]), request(events), createTurnRef(() => undefined), () => "auto-edit")
    expect(events[0]).toMatchObject({
      type: "engine.notification", key: "plugin-install:team", message: expect.stringContaining("403"),
    })
  })
})
