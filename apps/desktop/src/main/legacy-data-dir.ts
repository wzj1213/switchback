import { existsSync, readFileSync, readdirSync, readlinkSync, renameSync, rmdirSync, writeFileSync } from "node:fs"
import { join, sep } from "node:path"
import { app, dialog } from "electron"

/**
 * 改名（omni → Switchback）之后第一次启动，把旧的数据目录搬过来。
 *
 * Electron 的数据目录跟着应用名走：`~/Library/Application Support/<应用名>`。
 * 应用名一改，新版本就对着一个空目录起来——会话、设置、配对过的设备全都「没了」。
 * 东西其实都还在旧目录里，所以只要在**任何代码碰数据目录之前**挪一次。
 *
 * 三种情况不挪：
 *
 * - **新目录里已经有东西了**：挪过了，或者两边都用过——不替用户决定留哪一份。
 *   注意不能拿「新目录在不在」来判断：Electron 在主进程脚本跑起来之前就把它建好了
 *   （实测：脚本第一行看到的是一个**空**目录），所以看的是「空不空」；
 * - **数据目录被 `--user-data-dir` 指到了别处**：那是冒烟测试或者用户自己的安排；
 * - **旧应用还开着**：它手里攥着这些文件，挪走会让它写到一半的东西落空。
 *   这时候拦下来，叫用户先退掉旧的——**不能放行**：一放行，日志、设置就会在新目录里
 *   各建一份，下次启动「新目录已经在了」，旧数据就再也搬不过来。
 */
export type LegacyMove = "none" | "move" | "blocked"

export const LEGACY_NAME = "omni"

/** 附件路径改写做过一次就留这个标记，以后启动不再扫会话记录。 */
const REHOMED = ".legacy-attachment-paths"

/** 这一步做了什么。日志要等 `createLogger` 之后才有，由 index.ts 接着记。 */
export interface LegacyReport {
  moved: boolean
  /** 改写了几行会话记录里的附件路径。 */
  rewritten: number
  /** 改写失败的原因。不致命：没留标记，下次启动再试。 */
  error?: string
}

export interface LegacyFacts {
  /** 当前的数据目录（`app.getPath("userData")`）。 */
  current: string
  /** 应用名决定的默认数据目录（`<appData>/<应用名>`）。 */
  defaultDir: string
  /** 旧数据目录（`<appData>/omni`）。 */
  legacy: string
  /** 目录里有什么；目录不存在返回 undefined。 */
  list: (path: string) => readonly string[] | undefined
  /** 旧应用此刻还在不在跑。 */
  legacyRunning: () => boolean
}

export function planLegacyMove(f: LegacyFacts): LegacyMove {
  if (f.current !== f.defaultDir) return "none"
  const now = f.list(f.current)
  if (now !== undefined && now.length > 0) return "none"
  if (f.list(f.legacy) === undefined) return "none"
  return f.legacyRunning() ? "blocked" : "move"
}

/** Chromium 的单例锁：数据目录里的 `SingletonLock` 是个符号链接，指向 `<主机名>-<pid>`。 */
export function lockHolderAlive(dir: string, alive: (pid: number) => boolean): boolean {
  let target: string
  try {
    target = readlinkSync(join(dir, "SingletonLock"))
  } catch {
    return false
  }
  const pid = Number(target.slice(target.lastIndexOf("-") + 1))
  return Number.isInteger(pid) && pid > 0 && alive(pid)
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // 进程在、只是不归我们管，也算活着
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

function listDir(path: string): readonly string[] | undefined {
  try {
    return readdirSync(path)
  } catch {
    return undefined
  }
}

function stop(title: string, detail: string): never {
  // `showErrorBox` 在 ready 之前也能弹；之后**必须同步退出**，理由见文件头第三条
  dialog.showErrorBox(title, detail)
  process.exit(1)
}

/**
 * 一行会话记录里，指着旧附件目录的附件路径换成新目录；没有要换的返回 undefined。
 *
 * **只动附件字段**（`attachments` / `draftAttachments` / `queuedAttachments`）：
 * 这几处是 Switchback 自己管的文件，搬了家就该跟着改。引擎跑命令时输出里顺带出现的
 * 旧路径是历史原文，不改。
 *
 * 不改的代价是实打实的：会话里的图显示不出来；更糟的是孤儿清理按路径认引用，
 * 对不上就把七天前的图全当孤儿删了——改名后第一次启动就这么删掉过一批。
 */
export function rewriteLine(line: string, from: string, to: string): string | undefined {
  if (!line.includes(from)) return undefined
  let event: unknown
  try {
    event = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof event !== "object" || event === null) return undefined
  const record = event as Record<string, unknown>
  const fix = (value: unknown): unknown =>
    typeof value === "string" && value.startsWith(from) ? to + value.slice(from.length) : value
  const changed = [
    patch(record["item"], "attachments", (list) => list.map(fix)),
    patch(record["thread"], "draftAttachments", (list) => list.map(fix)),
    patch(record["thread"], "queuedAttachments", (list) => list.map((inner) => (Array.isArray(inner) ? inner.map(fix) : inner))),
  ].some(Boolean)
  return changed ? JSON.stringify(event) : undefined
}

function patch(owner: unknown, key: string, map: (list: unknown[]) => unknown[]): boolean {
  if (typeof owner !== "object" || owner === null) return false
  const record = owner as Record<string, unknown>
  const list = record[key]
  if (!Array.isArray(list)) return false
  const next = map(list)
  if (JSON.stringify(next) === JSON.stringify(list)) return false
  record[key] = next
  return true
}

/** 把一个目录里的 `*.jsonl` 逐行改写，返回改了几行。先写临时文件再换名，半截写坏不了原文件。 */
export function rewriteJournals(dir: string, from: string, to: string): number {
  let total = 0
  for (const name of listDir(dir) ?? []) {
    if (!name.endsWith(".jsonl")) continue
    const file = join(dir, name)
    const text = readFileSync(file, "utf8")
    if (!text.includes(from)) continue
    let count = 0
    const lines = text.split("\n").map((line) => {
      const fixed = rewriteLine(line, from, to)
      if (fixed !== undefined) count += 1
      return fixed ?? line
    })
    if (count === 0) continue
    writeFileSync(`${file}.tmp`, lines.join("\n"))
    renameSync(`${file}.tmp`, file)
    total += count
  }
  return total
}

function rehome(current: string, legacy: string): Pick<LegacyReport, "rewritten" | "error"> {
  const marker = join(current, REHOMED)
  if (existsSync(marker)) return { rewritten: 0 }
  try {
    const rewritten = rewriteJournals(join(current, "threads"), join(legacy, "attachments") + sep, join(current, "attachments") + sep)
    writeFileSync(marker, "")
    return { rewritten }
  } catch (error) {
    return { rewritten: 0, error: error instanceof Error ? error.message : String(error) }
  }
}

function move(legacy: string, current: string): void {
  try {
    // Electron 先建好的那个空目录要先拿掉，rename 才不会撞上它
    if (listDir(current) !== undefined) rmdirSync(current)
    renameSync(legacy, current)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    // i18n-ok：只有改名前用过 omni 的人会看到，而且这时设置还没读出来，没有界面语言可依
    stop("旧数据没搬过来", `想把 ${legacy} 挪到 ${current}，失败了：${why}\n两个目录都没动，可以手动挪过去再打开。`)
  }
}

/** 在主进程最开头调一次，早于任何 `app.getPath("userData")` 的使用者。 */
export function adoptLegacyDataDir(): LegacyReport {
  const appData = app.getPath("appData")
  const legacy = join(appData, LEGACY_NAME)
  const facts: LegacyFacts = {
    current: app.getPath("userData"),
    defaultDir: join(appData, app.getName()),
    legacy,
    list: listDir,
    legacyRunning: () => lockHolderAlive(legacy, pidAlive),
  }
  const plan = planLegacyMove(facts)
  if (plan === "blocked") {
    // i18n-ok：同上，只给改名前的老用户
    stop("请先退出 omni", "Switchback 就是改了名的 omni。旧的那个还开着——退出它之后再打开 Switchback，会话和设置会自动搬过来。")
  }
  if (plan === "move") move(legacy, facts.current)
  // 数据目录被指到别处（冒烟测试）时那里的记录和旧目录无关，不碰
  if (facts.current !== facts.defaultDir) return { moved: false, rewritten: 0 }
  return { moved: plan === "move", ...rehome(facts.current, legacy) }
}

/** 给日志的一句话；什么都没发生时不写。 */
export function legacyNote(r: LegacyReport): string | undefined {
  // i18n-ok：只进日志
  if (r.error !== undefined) return `会话记录里的旧附件路径没改成：${r.error}（下次启动再试）`
  if (!r.moved && r.rewritten === 0) return undefined
  // i18n-ok：只进日志
  return `${r.moved ? "旧数据目录已搬过来；" : ""}改写了 ${String(r.rewritten)} 行会话记录里的附件路径`
}
