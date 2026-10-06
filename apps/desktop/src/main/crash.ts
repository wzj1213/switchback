import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { app, crashReporter, type BrowserWindow } from "electron"
import type { Logger } from "./log.js"

/**
 * 崩溃留痕。
 *
 * ## 一切都留在本机
 *
 * `uploadToServer: false`。Switchback 不往任何服务器发东西——**这不是省事，是产品前提**：
 * 崩溃转储里可能有内存快照，而这个应用的内存里装着用户的代码、提示词、路径。
 * 把它悄悄传出去，一次就够失去信任。
 *
 * 转储落在系统给的 crashDumps 目录，用户自己看得到、删得掉；
 * 「帮助 → 导出诊断报告」里只列**文件名和时间**，不含转储内容——
 * 那一份是要发给别人的，不能夹带内存快照。
 *
 * ## 三种「崩」，来源不同
 *
 * | 谁崩了 | 怎么发现 | 用户看到什么 |
 * | --- | --- | --- |
 * | 渲染层 | `render-process-gone` | 界面白屏或自动重载 |
 * | GPU / 工具进程 | `child-process-gone` | 通常没感觉，但会拖慢或黑图 |
 * | 主进程 | **只能靠下次启动时发现** | 窗口直接消失，什么都没有 |
 *
 * 第三种是最要紧的：主进程死了就没人记日志了。所以用一个**运行标记文件**——
 * 启动时写，正常退出时删。下次启动发现它还在，就说明上次是崩着走的。
 */

const MARKER = "running.pid"

/** 转储保留多少天。留太久没意义，还占地方——真要查的是最近那次。 */
const KEEP_DAYS = 14

export interface CrashInfo {
  /** 上次是不是没干净退出。 */
  uncleanExit: boolean
  /** 崩溃转储文件名与时间，**不含内容**。诊断报告只报这些。 */
  dumps: readonly { name: string; at: number }[]
}

function markerPath(): string {
  return join(app.getPath("userData"), MARKER)
}

export function dumpDir(): string {
  return app.getPath("crashDumps")
}

/** 列出转储。只报文件名和时间——内容里可能有内存快照，不进任何要外发的东西。 */
export function listDumps(): readonly { name: string; at: number }[] {
  const dir = dumpDir()
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".dmp"))
      .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

/** 清掉过期转储。失败不影响启动——它只是打扫卫生。 */
function sweep(): void {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000
  for (const dump of listDumps()) {
    if (dump.at >= cutoff) continue
    try {
      rmSync(join(dumpDir(), dump.name))
    } catch {
      // 删不掉就算了
    }
  }
}

/**
 * 开崩溃记录，并回答「上次是不是崩着走的」。
 *
 * **必须在 `app.whenReady()` 之前调**：`crashReporter.start` 要赶在
 * 渲染进程被创建之前，否则那些进程不会带上崩溃处理器。
 */
export function installCrashReporter(log: Logger): CrashInfo {
  crashReporter.start({ uploadToServer: false, compress: false })

  const marker = markerPath()
  const uncleanExit = existsSync(marker)
  if (uncleanExit) {
    log.write("warn", "crash", "上次不是正常退出的（运行标记还在）。若有转储，见诊断报告。")
  }
  try {
    mkdirSync(app.getPath("userData"), { recursive: true })
    writeFileSync(marker, String(process.pid), "utf8")
  } catch {
    // 写不了标记只是失去这项检测，不该拦着应用启动
  }
  sweep()

  const dumps = listDumps()
  if (dumps.length > 0) {
    log.write("info", "crash", `本机留有 ${String(dumps.length)} 份崩溃转储，最近一份 ${dumps[0]?.name ?? ""}`)
  }
  return { uncleanExit, dumps }
}

/** 正常退出时把标记删掉。删不掉的话下次会误报一次崩溃——比漏报强。 */
export function clearMarker(): void {
  try {
    rmSync(markerPath())
  } catch {
    // 已经没了，或者删不掉
  }
}

/**
 * 子进程崩溃的记录。
 *
 * 渲染层崩了 Electron 会**自动重载**，用户往往只看到界面闪一下——
 * 不记的话这件事在日志里一点痕迹都没有，而它恰恰是最该被查的。
 */
export function watchProcesses(log: Logger, windows: () => readonly BrowserWindow[]): void {
  app.on("render-process-gone", (_e, contents, details) => {
    log.write(
      "error",
      "crash",
      `渲染进程结束：${details.reason} exitCode=${String(details.exitCode)} url=${contents.getURL()}`,
    )
    // `clean-exit` 是关窗时的正常路径，不算崩
    if (details.reason === "clean-exit" || details.reason === "killed") return
    for (const win of windows()) {
      if (!win.isDestroyed() && win.webContents === contents) win.webContents.reload()
    }
  })

  app.on("child-process-gone", (_e, details) => {
    if (details.reason === "clean-exit") return
    log.write(
      "warn",
      "crash",
      `子进程结束：type=${details.type} reason=${details.reason} exitCode=${String(details.exitCode)}`,
    )
  })
}
