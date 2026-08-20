import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createAcpDriver } from "./driver.js"

/**
 * @deprecated 这不是内置 Kimi 的验收路径。内置链路已经改走 `kimi web`；
 * 这里只保留作通用 ACP `terminal/*` 兼容性的真机考古样本。
 *
 * 让真的 kimi 跑一条 shell 命令，看输出有没有回来。
 *
 *   pnpm vitest run --mode live packages/engine/src/acp/kimi-shell.live.test.ts
 *
 * ## 为什么这条必须是 live
 *
 * 它钉的是一件桩测试永远发现不了的事：**omni 不认领 `terminal/*` 时，
 * kimi 一条命令都跑不了**。桩会照着我们以为的样子回答，而这里的错正是
 * 「我们以为的样子」错了——`driver.ts` 曾经写着「不认领也不影响拿输出」，
 * 那句话的证据来自 codex-acp，被当成了全家族的结论。
 *
 * 真实表现是**静默的能力损失**：kimi 照样读写文件、看起来一切正常，
 * 只是 Bash 工具每次都 failed，而 omni 这边不会有任何横幅或告警。
 * 用户是靠模型自己在正文里提了一句才发现的。这类故障没有任何东西出错，
 * 所以只能靠这条测试守。
 *
 * 前提：装了 kimi 并 `/login` 过。跑一句 `echo`，token 成本极小。
 */

const MARK = "OMNI_SHELL_OK_9317"

describe("kimi ACP（废弃链路）· live · shell", () => {
  it(
    "认领 `terminal/*` 之后，命令真的跑起来并且输出回到了正文里",
    async () => {
      const events: Event[] = []
      const driver = createAcpDriver({
        id: "kimi",
        command: "kimi",
        args: ["acp"],
        // 这一位就是这条测试的全部意义。改成 false 它必然红——那正是修复前的样子
        terminal: true,
      })
      const session = await driver.start({
        threadId: "th-kimi-shell",
        cwd: mkdtempSync(join(tmpdir(), "omni-kimi-sh-")),
        // 只读档下 kimi 落在它自己的 plan 模式，压根不执行工具——那时测不到这件事
        trust: "full",
        home: process.env["HOME"] ?? "",
        memory: () => [],
        emit: (e) => events.push(e),
        askUser: () => Promise.resolve({ allow: true, remember: "once" as const }),
      })
      try {
        await session.prompt(`用 shell 跑一句 \`echo ${MARK}\`，把原始输出贴给我。不要做别的。`, "turn-1")
        await new Promise<void>((resolve) => {
          const id = setInterval(() => {
            if (events.some((e) => e.type === "turn.completed")) {
              clearInterval(id)
              resolve()
            }
          }, 500)
        })
        const text = events
          .flatMap((e) => (e.type === "item.started" || e.type === "item.updated" ? [e.item] : []))
          .flatMap((item) => (item.kind === "agent_message" ? [item.text] : []))
          .join("\n")
        // **它把 echo 的输出贴回来了**——这一句同时证明了三件事：
        // 进程起来了、输出收到了、`terminal/output` 的形状对得上
        expect(text).toContain(MARK)
        // 反面：修复前模型会说「shell 不可用」。这句话出现就是回归了
        expect(text).not.toContain("unavailable")
      } finally {
        await session.dispose()
      }
    },
    300_000,
  )
})
