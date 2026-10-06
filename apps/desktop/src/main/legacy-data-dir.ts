import { readdirSync, readlinkSync, renameSync, rmdirSync } from "node:fs"
import { join } from "node:path"
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

/** 在主进程最开头调一次，早于任何 `app.getPath("userData")` 的使用者。 */
export function adoptLegacyDataDir(): void {
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
    stop("请先退出 omni", "Switchback 就是改了名的 omni。旧的那个还开着——退出它之后再打开 Switchback，会话和设置会自动搬过来。")
  }
  if (plan !== "move") return
  try {
    // Electron 先建好的那个空目录要先拿掉，rename 才不会撞上它
    if (listDir(facts.current) !== undefined) rmdirSync(facts.current)
    renameSync(legacy, facts.current)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    stop("旧数据没搬过来", `想把 ${legacy} 挪到 ${facts.current}，失败了：${why}\n两个目录都没动，可以手动挪过去再打开。`)
  }
}
