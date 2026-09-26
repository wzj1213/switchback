import { describe, expect, it } from "vitest"
import { disconnectText } from "./disconnect.js"
import type { KimiDisconnect } from "./stream.js"

describe("断开原因的一句话", () => {
  const cases: readonly [KimiDisconnect, string][] = [
    [{ kind: "closed", code: 1001, reason: "heartbeat timeout" }, "Kimi 的实时连接断了（1001 heartbeat timeout），正在接回"],
    [{ kind: "closed", code: 1006 }, "Kimi 的实时连接断了（1006），正在接回"],
    [{ kind: "closed" }, "Kimi 的实时连接断了，正在接回"],
    [{ kind: "resync", why: "omni 发现流里有缺口" }, "Kimi 的实时流要重新同步（omni 发现流里有缺口），正在按会话快照接回"],
    [{ kind: "error", message: "炸了" }, "omni 处理 Kimi 推来的消息时出错（炸了），正在按会话快照接回"],
  ]
  for (const [cause, want] of cases) it(want, () => expect(disconnectText(cause)).toBe(want))
})
