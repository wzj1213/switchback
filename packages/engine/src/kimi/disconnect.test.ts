import { describe, expect, it } from "vitest"
import { disconnectText } from "./disconnect.js"
import type { KimiDisconnect } from "./stream.js"

describe("断开原因的一句话", () => {
  const cases: readonly [KimiDisconnect, string][] = [
    [{ kind: "closed", code: 1001, reason: "heartbeat timeout" }, "Kimi 的实时连接断了（1001 heartbeat timeout），正在接回"],
    [{ kind: "closed", code: 1006 }, "Kimi 的实时连接断了（1006），正在接回"],
    [{ kind: "closed" }, "Kimi 的实时连接断了，正在接回"],
    [{ kind: "resync", by: "switchback" }, "Kimi 的实时流要重新同步（Switchback 发现流里有缺口），正在按会话快照接回"],
    [{ kind: "resync", by: "kimi" }, "Kimi 的实时流要重新同步（服务端要求重新同步），正在按会话快照接回"],
    [{ kind: "error", message: "炸了" }, "Switchback 处理 Kimi 推来的消息时出错（炸了），正在按会话快照接回"],
  ]
  for (const [cause, want] of cases) it(want, () => expect(disconnectText(cause)).toBe(want))
})

describe("英文界面下的同一句", () => {
  const cases: readonly [KimiDisconnect, string][] = [
    [{ kind: "closed", code: 1001, reason: "heartbeat timeout" }, "Kimi's live connection dropped (1001 heartbeat timeout); reconnecting"],
    [{ kind: "closed" }, "Kimi's live connection dropped; reconnecting"],
    [{ kind: "resync", by: "switchback" }, "Kimi's live stream needs a resync (Switchback found a gap in the stream); reconnecting from the thread snapshot"],
    [{ kind: "error", message: "boom" }, "Switchback hit an error handling a message from Kimi (boom); reconnecting from the thread snapshot"],
  ]
  for (const [cause, want] of cases) it(want, () => expect(disconnectText(cause, "en")).toBe(want))
})
