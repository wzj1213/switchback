import { randomUUID } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@switchback/protocol"
import { createClaudeDriver } from "@switchback/engine"
import { initial, itemsOf, reduce, threadsOf, type ViewState } from "@switchback/store"
import { createHost } from "./host.js"

/**
 * 全链路：宿主 → Claude 驱动 → 真实 claude 子进程 → 事件 → 归约器 → 视图状态。
 * 唯一没覆盖的是 Electron 的 IPC 与 React 渲染。
 *
 *   pnpm test:live
 *
 * 会消耗真实额度并在临时目录里起子进程。
 */

describe("全链路 · live", () => {
  it(
    "一次真实对话能一路走到视图状态",
    async () => {
      const cwd = mkdtempSync(join(tmpdir(), "switchback-host-"))
      writeFileSync(join(cwd, "answer.txt"), "42\n")

      const events: Event[] = []
      const state = { view: initial() as ViewState }
      const host = createHost({
        drivers: { claude: createClaudeDriver() },
        home: homedir(),
        emit: (e) => {
          events.push(e)
          state.view = reduce(state.view, e)
        },
        newId: (prefix) => `${prefix}-${randomUUID()}`,
        now: () => Date.now(),
      })

      await host.dispatch({ type: "thread.create", cwd, engine: "claude", trust: "auto-edit" })
      const thread = threadsOf(state.view)[0]
      expect(thread).toBeDefined()

      await host.dispatch({
        type: "thread.prompt",
        threadId: thread?.id ?? "",
        text: "读取 answer.txt，只回答文件里的那个数字，不要解释。",
      })

      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (events.some((e) => e.type === "turn.completed")) {
            clearInterval(timer)
            resolve()
          }
        }, 250)
        setTimeout(() => {
          clearInterval(timer)
          resolve()
        }, 150_000)
      })
      await host.dispose()

      const items = itemsOf(state.view, thread?.id ?? "")
      // 宿主发的用户消息进了 transcript
      expect(items.some((i) => i.kind === "user_message")).toBe(true)
      // 引擎的产出也进了同一条 transcript——归约器把两边接上了
      expect(items.some((i) => i.kind === "agent_message")).toBe(true)
      // 读文件这一步应该被翻译成工具调用
      expect(items.some((i) => i.kind === "tool_call")).toBe(true)
      // 轮次已收工，界面不该还显示「运行中」
      expect(state.view.turns[thread?.id ?? ""]).toBeUndefined()
    },
    180_000,
  )
})
