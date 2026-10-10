import { describe, expect, it } from "vitest"
import type { Thread } from "@switchback/protocol"
import { cannotRevive } from "./revive.js"

const thread: Thread = {
  id: "t", title: "旧会话", cwd: "/w", engine: "codex", trust: "auto-edit", status: "idle",
  createdAt: 0, updatedAt: 0, engineHistory: ["codex"], engineHandle: "h", detached: true,
}
const seg = (engine: string): NonNullable<Thread["segments"]>[number] => ({ engine, handle: `h-${engine}`, startedAt: 0 })
const claude = { ...thread, engine: "claude", engineHistory: ["codex", "claude"], engineHandle: undefined }

describe("历史会话接不接得回", () => {
  const cases: readonly { name: string; thread: Thread; want: boolean }[] = [
    { name: "留着句柄：接得回", thread, want: false },
    { name: "活会话没有句柄是还没跑过第一轮，不是接不回", thread: { ...thread, engineHandle: undefined, detached: false }, want: false },
    { name: "历史会话没句柄、一段都没有：接不回", thread: { ...thread, engineHandle: undefined }, want: true },
    { name: "挑了别家：由那家接着做，不拦", thread: { ...thread, engineHandle: undefined, nextEngine: "claude" }, want: false },
    { name: "换过来还没开口就停了（有别家的分段、没有这一家的）：宿主新起一条", thread: { ...claude, segments: [seg("codex")] }, want: false },
    { name: "这一家说过话却没留下句柄：接不回", thread: { ...claude, segments: [seg("codex"), seg("claude")] }, want: true },
    { name: "整条会话一段都没有：接不回", thread: { ...claude, segments: [] }, want: true },
  ]
  for (const one of cases) {
    it(one.name, () => expect(cannotRevive(one.thread)).toBe(one.want))
  }
})
