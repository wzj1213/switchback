import type { Trust } from "@omni/protocol"
import type { AcpMode } from "./wire.js"

/**
 * 信任档 → ACP 的 mode。
 *
 * ## 为什么这里只能靠猜
 *
 * codex 的 `sandbox` 是三个固定枚举值，写死一张表就完了。ACP 不是：
 * `availableModes` 是 **agent 自己定义的一串字符串**，协议不规定叫什么、
 * 有几个、什么语义。实测 codex-acp 报的是：
 *
 * ```
 * read-only / agent / agent-full-access   （currentModeId: agent）
 * ```
 *
 * 换一家 ACP agent 完全可能是 `plan / edit / yolo`，或者一个都没有。
 * 所以这里做的是**打分匹配**，不是查表。
 *
 * ## 猜错的方向必须是安全的那一边
 *
 * 关键约束：分数相同或都不匹配时，**取列表里最靠前的那个**——
 * ACP 的惯例（也是 codex-acp 的实际排法）是从严到宽排列。
 * 猜偏一档只是多问几次；猜到 full access 那一档，就是把一个
 * 「能改工作区外的文件、能联网」的模式悄悄打开了。
 *
 * 匹配不上时驱动**不发** `session/set_mode`，保持 agent 自己的默认档，
 * 并报一条 `engine.status` 说明——见 `driver.ts`。让人知道「omni 的档位
 * 在这家引擎上没接上」，比让他以为接上了强得多。
 */

/** 各档的关键词与权重。命中就加分，负分是「明确不像这一档」。 */
const HINTS: Readonly<Record<Trust, readonly (readonly [string, number])[]>> = {
  "read-only": [
    ["read-only", 10],
    ["readonly", 10],
    ["read only", 10],
    ["plan", 6],
    ["ask", 4],
    ["chat", 3],
    ["full", -10],
    ["auto", -6],
  ],
  "auto-edit": [
    ["agent", 6],
    ["edit", 6],
    ["write", 5],
    ["auto", 4],
    ["default", 3],
    ["full", -8],
    ["read-only", -10],
    ["readonly", -10],
    ["danger", -10],
    ["bypass", -10],
    ["yolo", -10],
  ],
  full: [
    ["full", 10],
    ["full-access", 12],
    ["danger", 8],
    ["bypass", 8],
    ["yolo", 8],
    ["all", 4],
    ["read-only", -12],
    ["readonly", -12],
    ["plan", -8],
  ],
}

function score(mode: AcpMode, trust: Trust): number {
  const hay = `${mode.id ?? ""} ${mode.name ?? ""}`.toLowerCase()
  return HINTS[trust].reduce((sum, [word, weight]) => (hay.includes(word) ? sum + weight : sum), 0)
}

/** 命中的最低分。低于它就当没匹配上——半个词的巧合不该拿来定安全档位。 */
const THRESHOLD = 4

export function pickMode(modes: readonly AcpMode[], trust: Trust): string | undefined {
  let best: { id: string; score: number } | undefined
  for (const mode of modes) {
    const id = mode.id
    if (id === undefined || id === "") continue
    const value = score(mode, trust)
    // 严格大于：并列时保留**先出现**的那个，也就是更严的那个
    if (value >= THRESHOLD && (best === undefined || value > best.score)) best = { id, score: value }
  }
  return best?.id
}
