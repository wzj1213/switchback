import { createJiti } from "jiti"
import { performance } from "node:perf_hooks"

const { initial, reduceAll } = await createJiti(import.meta.url).import("../packages/store/src/index.ts")

/** 合成历史，不读用户记录；固定数据规模，时间仅报告、不作为 CI 断言。 */
function history(count) {
  return [
    { type: "thread.started", at: 0, thread: {
      id: "t", title: "性能样本", cwd: "/tmp", engine: "codex", trust: "auto-edit", status: "idle",
      createdAt: 0, updatedAt: 0, engineHistory: ["codex"],
    } },
    { type: "turn.started", at: 0, turn: {
      id: "u", threadId: "t", engine: "codex", status: "running", startedAt: 0,
    } },
    ...Array.from({ length: count }, (_, i) => ({
      type: "item.started", at: i, item: {
        id: `i-${i}`, turnId: "u", kind: "agent_message", text: `样本 ${i}`, at: i,
      },
    })),
  ]
}

for (const count of [1000, 10_000, 30_000]) {
  const events = history(count)
  reduceAll(initial(), events)
  const samples = Array.from({ length: 5 }, () => {
    const start = performance.now()
    const state = reduceAll(initial(), events)
    if (state.items.t?.length !== count) throw new Error("回放丢失消息")
    return performance.now() - start
  }).sort((a, b) => a - b)
  console.log(`${count} 条消息：中位 ${samples[2].toFixed(1)} ms（5 次）`)
}
