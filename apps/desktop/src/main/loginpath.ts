import { execFile } from "node:child_process"
import { homedir } from "node:os"
import { resolveLoginPath } from "@omni/engine"
import type { Logger } from "./log.js"

/**
 * 启动时把 PATH 补成登录 shell 里的那一份。**必须在探测引擎和 spawn 之前跑。**
 *
 * 从 Dock 点开的进程 PATH 恒为 `/usr/bin:/bin:/usr/sbin:/sbin`，而 codex 在
 * `/opt/homebrew/bin`、ACP 引擎多在 `~/.local/bin`——不补的话，
 * **装出来的包一开就说找不到引擎，而 `pnpm dev` 下一切正常**。
 *
 * 排查提示写在这里，免得下次又踩：**别用 `open -a` 复现**。
 * macOS 的 `open` 会把调用方的环境转发给应用，PATH 看着是全的，
 * 会让人误判「这个 bug 不存在」。要么真从 Dock 点，要么对着已启动的进程
 * `ps eww <pid>` 取证。
 */
export async function fixPath(log: Logger): Promise<void> {
  const before = process.env["PATH"] ?? ""
  const after = await resolveLoginPath(before, {
    shell: process.env["SHELL"],
    home: homedir(),
    platform: process.platform,
    run: runShell,
  })
  if (after === before) return
  process.env["PATH"] = after
  const added = after.split(":").filter((d) => !before.split(":").includes(d))
  log.write("info", "app", `PATH 补齐：多了 ${String(added.length)} 个目录（${added.slice(0, 3).join("、")}…）`)
}

/**
 * 跑一次登录 shell 取输出。
 *
 * **超时必须硬**：交互式 shell 的 rc 文件什么都可能干（等网络、等输入）。
 * 卡住的代价是整个应用起不来，而它换来的只是几个目录——超时就走垫底方案。
 */
function runShell(cmd: string, args: readonly string[], timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = execFile(cmd, [...args], { timeout: timeoutMs, encoding: "utf8" }, (error, stdout) => {
      // 有输出就用，哪怕 shell 自己报了错——rc 里一个失败的 `source` 不该
      // 连累我们拿不到 PATH
      resolve(error !== null && stdout === "" ? undefined : stdout)
    })
    child.on("error", () => {
      resolve(undefined)
    })
  })
}
