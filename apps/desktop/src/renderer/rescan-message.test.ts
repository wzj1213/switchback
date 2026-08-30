import { describe, expect, it } from "vitest"
import { rescanMessage, type EngineChange } from "./rescan-message.js"

describe("rescanMessage", () => {
  const cases: readonly {
    name: string
    changed: readonly EngineChange[]
    restart?: readonly string[]
    want: string
  }[] = [
    {
      name: "什么都没变也要说话——否则和「按钮没反应」分不开",
      changed: [],
      want: "查过了，没有变化——装的还是那几家。",
    },
    {
      name: "刚装上一家",
      changed: [{ id: "codex", label: "Codex", state: "ok" }],
      want: "认出了 Codex。",
    },
    {
      name: "一次认出两家（用户在终端里连装了两个）",
      changed: [
        { id: "codex", label: "Codex", state: "ok" },
        { id: "kimi", label: "Kimi Code", state: "ok" },
      ],
      want: "认出了 Codex、Kimi Code。",
    },
    {
      name: "卸掉了一家",
      changed: [{ id: "codex", label: "Codex", state: "missing" }],
      want: "Codex 现在用不了了。",
    },
    {
      name: "「起不来」和「没装」在这句话里是同一拨——差别由那一行自己说",
      changed: [{ id: "grok", label: "Grok", state: "unavailable" }],
      want: "Grok 现在用不了了。",
    },
    {
      name: "一来一去",
      changed: [
        { id: "codex", label: "Codex", state: "ok" },
        { id: "grok", label: "Grok", state: "missing" },
      ],
      want: "认出了 Codex；Grok 现在用不了了。",
    },
    {
      name: "状态缺席按「用不了」算：说不清就别说成能用",
      changed: [{ id: "dsh", label: "DSH" }],
      want: "DSH 现在用不了了。",
    },
    {
      name: "改过的那几家没兑现——**单独说**，别混进「已经变了」那句里",
      changed: [],
      restart: ["ZCode"],
      want: "查过了，没有变化——装的还是那几家。ZCode 改过了，要重启 omni 才生效。",
    },
    {
      name: "新接了一家、另一家改过了：两件事各说各的",
      changed: [{ id: "acp:zcode", label: "ZCode", state: "ok" }],
      restart: ["旧适配器"],
      want: "认出了 ZCode。旧适配器 改过了，要重启 omni 才生效。",
    },
  ]
  it.each(cases)("$name", ({ changed, restart, want }) => {
    expect(rescanMessage(changed, restart)).toBe(want)
  })
})
