import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { ipcMain } from "electron"

const run = promisify(execFile)

/**
 * 工作区的即时状态：在哪个分支上、有没有没提交的改动。
 *
 * ## 为什么值得专门做一条通道
 *
 * **「引擎会改到哪个分支」这件事，界面上以前一个字都没有。** 你在
 * `feature/x` 上开了会话，切到 `main` 去做别的，回来接着让它改——
 * 它改的是 main。这件事发生的时候没有任何提示，而发现它通常要等到
 * `git status` 之后。
 *
 * 「有没有未提交改动」同理：agent 在一堆脏改动上面继续动手，
 * 出问题时 `git diff` 里两个人的改动混在一起，分不出哪些是它做的。
 *
 * ## 便宜、可失败、不缓存
 *
 * 两条 `git` 命令，几毫秒。不缓存是有意的：分支和脏不脏**随时会变**
 * （用户在终端里切了分支），缓存的代价是界面显示一个过期的分支名——
 * 而一个过期的分支名比不显示更危险。
 */

export interface WorksiteInfo {
  /** 不是 git 仓库时缺席。 */
  branch?: string
  /** 有未提交的改动（含未跟踪文件）。 */
  dirty?: boolean
}

const TIMEOUT = 3000

export async function worksiteInfo(cwd: string): Promise<WorksiteInfo> {
  const head = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeout: TIMEOUT }).catch(
    () => undefined,
  )
  // 不是仓库、或者 git 没装——两种都只是「没有分支可显示」，不是错误
  if (head === undefined) return {}
  const status = await run("git", ["status", "--porcelain"], { cwd, timeout: TIMEOUT }).catch(() => undefined)
  return {
    branch: head.stdout.trim(),
    ...(status === undefined ? {} : { dirty: status.stdout.trim() !== "" }),
  }
}

export function installWorksiteChannel(): void {
  ipcMain.handle("omni:worksite", async (_e, cwd: string) =>
    typeof cwd === "string" && cwd !== "" ? worksiteInfo(cwd) : {},
  )
}
