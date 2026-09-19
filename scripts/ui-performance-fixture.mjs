import { stubThread } from "./ui-fixture.mjs"

/** 真实说过一句话的历史；只有 started 的空壳会由宿主当作临时会话收走。 */
export function sidebarThread(id, title, cwd, at) {
  const turnId = `${id}-turn`
  return stubThread(id, title, cwd, at) + [
    { type: "turn.started", at, turn: { id: turnId, threadId: id, engine: "claude", status: "running", startedAt: at } },
    { type: "item.started", at, item: { id: `${id}-q`, turnId, kind: "user_message", text: title, at } },
    { type: "turn.completed", at, turnId, status: "completed" },
  ].map(event => JSON.stringify(event)).join("\n") + "\n"
}

/** 240 轮带 Markdown/代码/表格的固定长会话，不读取用户数据、不发送任务。 */
export function longThread(id, cwd, at) {
  const events = [JSON.parse(stubThread(id, "长会话性能样本", cwd, at).split("\n")[0])]
  for (let i = 0; i < 240; i++) {
    const turnId = `${id}-turn-${i}`
    const when = at + i * 10_000
    events.push({ type: "turn.started", at: when, turn: {
      id: turnId, threadId: id, engine: "claude", status: "running", startedAt: when,
    } })
    const text = `## 第 ${i + 1} 轮验证\n\n` +
      "逐项检查会话、滚动和文件阅读，保留完整记录。\n\n".repeat(6) +
      "```ts\n" + "const ready = items.filter(item => item.complete)\n".repeat(12) + "```\n\n" +
      "| 项目 | 结果 |\n| --- | --- |\n| 会话 | 通过 |\n| 文件 | 通过 |\n\n" +
      `历史查找标记-${i}`
    for (const item of [
      { id: `${id}-q-${i}`, kind: "user_message", text: `检查第 ${i + 1} 轮`, at: when },
      { id: `${id}-a-${i}`, kind: "agent_message", text, complete: true, at: when + 1000 },
    ]) events.push({ type: "item.started", at: item.at, item: { ...item, turnId } })
    events.push({ type: "turn.completed", at: when + 2000, turnId, status: "completed" })
  }
  return events.map(event => JSON.stringify(event)).join("\n") + "\n"
}
