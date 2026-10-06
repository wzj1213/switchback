import { execFile } from "node:child_process"
import { realpath } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { ipcMain } from "electron"
import type { WorksiteSearch } from "./worksite-search.js"
import { ownedWorksite } from "./worksite-search.js"

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
  /**
   * 分支名。**游离时这里是短 sha**（配合 `detached`），不是分支名。
   * 不是 git 仓库时缺席。
   */
  branch?: string
  /** HEAD 没有指向任何分支（`git checkout <sha>` 之后）。 */
  detached?: boolean
  /** 有未提交的改动（含未跟踪文件）。 */
  dirty?: boolean
  /**
   * 未提交的文件数。**一个点说不出「三个」还是「三百个」**——
   * 而这两种情况下你该不该让引擎接着动手，答案是不一样的。
   *
   * 没 gitignore 的 `node_modules` 会让这个数上万，所以芯片上显示时要截断
   * （见 `Chips.tsx`）；这里给准确值，环境卡照原样显示。
   */
  dirtyCount?: number
}

const TIMEOUT = 3000

/**
 * HEAD 在哪儿。**不用 `rev-parse --abbrev-ref HEAD`**——它在两种真实情况下说假话：
 *
 * | 情况 | `rev-parse --abbrev-ref HEAD` | 界面上的表现 |
 * |---|---|---|
 * | 刚 `git init`，还没有提交 | `fatal: ambiguous argument 'HEAD'` | **分支芯片整枚消失**，看起来像「这不是个仓库」 |
 * | `git checkout <sha>` 之后 | 字面量 `HEAD` | 显示成**一个叫 `HEAD` 的分支**，纯属编造 |
 *
 * 两条都实测过（2026-08-19）。改成两步：
 *
 * 1. `symbolic-ref --short HEAD` —— 空仓库上照样回 `main`（它读的是 HEAD 这个**引用**
 *    指向哪儿，不需要那个 commit 真的存在）。成功就是在分支上。
 * 2. 失败说明 HEAD 不是符号引用，也就是游离——再问 `rev-parse --short HEAD` 拿 sha。
 *    这一步**同时**兜住「压根不是 git 仓库」：那时两条都失败，返回 undefined。
 */
async function headOf(cwd: string): Promise<{ branch: string; detached: boolean } | undefined> {
  const ref = await run("git", ["symbolic-ref", "--short", "HEAD"], { cwd, timeout: TIMEOUT }).catch(
    () => undefined,
  )
  if (ref !== undefined) return { branch: ref.stdout.trim(), detached: false }
  const sha = await run("git", ["rev-parse", "--short", "HEAD"], { cwd, timeout: TIMEOUT }).catch(() => undefined)
  // 不是仓库、或者 git 没装——两种都只是「没有分支可显示」，不是错误
  if (sha === undefined) return undefined
  return { branch: sha.stdout.trim(), detached: true }
}

export async function worksiteInfo(cwd: string): Promise<WorksiteInfo> {
  const head = await headOf(cwd)
  if (head === undefined) return {}
  const status = await run("git", ["status", "--porcelain", "-z", "-uall"], { cwd, timeout: TIMEOUT }).catch(
    () => undefined,
  )
  if (status === undefined) return { branch: head.branch, ...(head.detached ? { detached: true } : {}) }
  // 和 `workChanges` 用同一个解析：两处对「几个文件变了」必须给同一个答案，
  // 各写一份的话芯片说 3 个、变更卡说 4 个，而它们指的是同一件事
  const count = parseStatus(status.stdout).length
  return {
    branch: head.branch,
    ...(head.detached ? { detached: true } : {}),
    dirty: count > 0,
    dirtyCount: count,
  }
}

/**
 * 工作区里**现在**和 HEAD 不一样的那些文件（含未跟踪的），绝对路径。
 *
 * ## 为什么界面需要它
 *
 * 变更汇总卡上那个数只认**编辑类工具报上来的**改动。引擎用 shell 直接写文件
 * （`sed -i`、`>` 重定向、跑一个生成脚本）一个都不算——Switchback 只看见「跑了一条命令」。
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
 * `XY <path>` → 状态码 + 路径。重命名那种是 `R  新\0旧`，`-z` 下旧名单独占一段；
 * 它不是第二个文件，但审核与会话归属仍要靠它认出“旧路径现在叫什么”。
 *
 * 状态码留着不扔：审核面板要靠它分「新建/删除/改名/修改」，
 * 以及第一位判「进没进暂存区」。
 */
export function codesOf(raw: string): readonly { code: string; rel: string; from?: string }[] {
  const out: { code: string; rel: string; from?: string }[] = []
  const parts = raw.split("\0")
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i]
    if (entry === undefined || entry.length < 4) continue
    const code = entry.slice(0, 2)
    const renamed = code.startsWith("R") || code.startsWith("C")
    const from = renamed ? parts[i + 1] : undefined
    out.push({ code, rel: entry.slice(3), ...(from === undefined || from === "" ? {} : { from }) })
    // 重命名/复制：下一段是旧名，不是另一个改动；审核卡还要留着它做跨轮归属。
    if (renamed) i += 1
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

export function installWorksiteChannel(worksites: WorksiteSearch): void {
  ipcMain.handle("switchback:worksite", async (_e, value: unknown) => {
    const req = ownedWorksite(value, worksites.owns)
    return req === undefined ? {} : worksiteInfo(req.cwd)
  })
}
