import type { Handoff } from "./build.js"

/** 上一家的最后一段话截到这么长——它是背景，不是要接手的一家去读的正文。 */
const MAX_LAST = 800

function section(title: string, lines: readonly string[]): string | undefined {
  return lines.length === 0 ? undefined : `## ${title}\n${lines.join("\n")}`
}

/**
 * 交接包 → 交给下一家的第一条消息。
 *
 * 写法上三条讲究：
 *
 * - **开头就说清「你是接手的」**。不说的话模型会把这段当成用户的普通陈述，
 *   然后礼貌地复述一遍，而不是接着干。
 * - **明确「已经批过的不要重问」**。人工裁决的成本最高，换一家之后重来一遍
 *   是这个功能最容易让人放弃的地方。
 * - **明确「工作区已经是这个状态了」**。不说的话它会把「改过的文件」当成
 *   待办事项再改一次。
 */
export function renderHandoff(handoff: Handoff, from: string, to: string): string {
  const head = [
    `你正在**接手**一段由 ${from} 开始的工作，现在由你（${to}）继续。`,
    "下面是交接内容。**工作区里的改动已经落盘了**，不要重做；",
    "**已经过人工裁决的事项不要重新征求同意**。",
  ].join("\n")

  const changed = handoff.changed.map(
    (f) => `- \`${f.path}\`（+${String(f.added)} −${String(f.removed)}）`,
  )
  const decisions = handoff.decisions.map(
    (d) => `- ${d.allowed ? "已批准" : "已拒绝"}：${d.summary}`,
  )
  const last =
    handoff.last === undefined
      ? undefined
      : `## 上一家最后的说明\n${handoff.last.slice(0, MAX_LAST)}`

  const body = [
    `## 目标\n${handoff.goal}`,
    section("过程中追加的要求", handoff.asks.map((a) => `- ${a}`)),
    section("已改动的文件", changed),
    section("已成功执行的命令", handoff.commands.map((c) => `- \`${c}\``)),
    section("已做过的裁决", decisions),
    section("尚未完成", handoff.open.map((o) => `- [ ] ${o}`)),
    last,
    "## 现在请你\n先确认工作区当前状态与上面是否一致，然后从「尚未完成」继续。",
  ].filter((s): s is string => s !== undefined)

  return `${head}\n\n${body.join("\n\n")}\n`
}
