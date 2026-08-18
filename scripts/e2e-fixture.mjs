/**
 * 端到端验收用的会话样本。
 *
 * 单独一个文件不是为了凑行数：**造样本和跑验收是两件事**，
 * 而这份样本的形状本身带着一条教训，值得单独放着（见下面的注释）。
 */

/**
 * 一条约 `chars` 个码元的会话记录。格式就是 journal 的：一行一条事件。
 *
 * **摊成很多条正常大小的事件**（每条约 1.6 KB，和真机上那两条 1549 条 / 2.5 MB
 * 的形状一致），不是一条巨大的事件——后者会被整条丢掉，演不出真正的毛病。
 */
export function fixture(id, chars) {
  const per = 1600
  const n = Math.max(1, Math.round(chars / per))
  const thread = {
    id,
    title: id,
    cwd: "/tmp",
    engine: "codex",
    trust: "auto-edit",
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    engineHistory: ["codex"],
  }
  const lines = [
    { type: "thread.started", at: 1, thread },
    { type: "turn.started", at: 1, turn: { id: `${id}-u`, threadId: id, engine: "codex", status: "running", startedAt: 1 } },
  ]
  for (let i = 0; i < n; i += 1) {
    lines.push({
      type: "item.started",
      at: 1,
      item: { id: `${id}-i${i}`, turnId: `${id}-u`, kind: "user_message", at: 1, text: "验收".repeat(Math.floor((per - 140) / 2)) },
    })
  }
  return lines.map((e) => JSON.stringify(e)).join("\n") + "\n"
}
