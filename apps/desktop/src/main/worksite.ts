import { execFile } from "node:child_process"
import { realpath } from "node:fs/promises"
import { join } from "node:path"
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

/**
 * 工作区里**现在**和 HEAD 不一样的那些文件（含未跟踪的），绝对路径。
 *
 * ## 为什么界面需要它
 *
 * 变更汇总卡上那个数只认**编辑类工具报上来的**改动。引擎用 shell 直接写文件
 * （`sed -i`、`>` 重定向、跑一个生成脚本）一个都不算——omni 只看见「跑了一条命令」。
 * 于是它跑完 `pnpm build` 改了三十个文件，卡上写着「0 个文件已更改」。
 * 问一次 git 就能把这块盲区摊开。
 *
 * **两个数字不合并**：编辑工具那份可以追溯到具体某一条工具行，这一份不能
 * （它分不出是引擎跑的命令改的，还是你自己在编辑器里改的）。置信度不同的东西
 * 加在一起，就再也分不开了。
 *
 * ## 三个必须处理的细节
 *
 * - **`-z`**：porcelain 的默认输出会给含空格或非 ASCII 的路径加引号并转义，
 *   自己解那套引号是纯粹的自找麻烦。`-z` 用 NUL 分隔，一个字符都不用转。
 * - **绝对路径**：porcelain 给的是相对**仓库根**的路径，而引擎报的是绝对路径，
 *   不换算的话两边永远对不上，「减去已知的那些」就成了空操作。
 * - **realpath**：macOS 上 `/tmp` 是 `/private/tmp` 的软链，而各家引擎报哪一种都有。
 *   两边都归一到真实路径，交集才算得对。
 */
export interface WorkChanges {
  /** 仓库根（真实路径）。不是 git 仓库时整个结果缺席。 */
  root: string
  /** 和 HEAD 不同的文件，绝对真实路径。 */
  paths: readonly string[]
}

/**
 * `XY <path>` → 状态码 + 路径。重命名那种是 `R  新\0旧`，`-z` 下旧名单独占一段，
 * 跳过即可（不跳会多算一个文件）。
 *
 * 状态码留着不扔：审核面板要靠它分「新建/删除/改名/修改」，
 * 以及第一位判「进没进暂存区」。
 */
export function codesOf(raw: string): readonly { code: string; rel: string }[] {
  const out: { code: string; rel: string }[] = []
  const parts = raw.split("\0")
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i]
    if (entry === undefined || entry.length < 4) continue
    const code = entry.slice(0, 2)
    out.push({ code, rel: entry.slice(3) })
    // 重命名/复制：下一段是旧名，不是另一个改动
    if (code.startsWith("R") || code.startsWith("C")) i += 1
  }
  return out
}

export function parseStatus(raw: string): readonly string[] {
  return codesOf(raw).map((e) => e.rel)
}

export async function workChanges(cwd: string): Promise<WorkChanges | undefined> {
  const top = await run("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: TIMEOUT }).catch(() => undefined)
  if (top === undefined) return undefined
  const root = await realpath(top.stdout.trim()).catch(() => top.stdout.trim())
  // `-uall`：不加的话未跟踪的**目录**折成一条 `sub/`，界面上看起来像一个文件
  const status = await run("git", ["status", "--porcelain", "-z", "-uall"], { cwd, timeout: TIMEOUT }).catch(
    () => undefined,
  )
  if (status === undefined) return { root, paths: [] }
  return { root, paths: parseStatus(status.stdout).map((rel) => join(root, rel)) }
}

export function installWorksiteChannel(): void {
  ipcMain.handle("omni:worksite", async (_e, cwd: string) =>
    typeof cwd === "string" && cwd !== "" ? worksiteInfo(cwd) : {},
  )
  ipcMain.handle("omni:workChanges", async (_e, cwd: string) =>
    typeof cwd === "string" && cwd !== "" ? workChanges(cwd) : undefined,
  )
}
