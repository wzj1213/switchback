import { writeFile } from "node:fs/promises"
import { app, type BrowserWindow } from "electron"
import type { Trust } from "@omni/protocol"

/**
 * 开发期用的自动化钩子，**全部由环境变量开关，默认完全不生效**。
 *
 * | 变量 | 作用 |
 * | --- | --- |
 * | `OMNI_DEV_PROMPT` | 默认会话建好后自动发这条提示词 |
 * | `OMNI_DEV_CWD` | 默认会话开在哪个目录，默认 `process.cwd()` |
 * | `OMNI_DEV_ENGINE` | 默认会话用哪个引擎，默认 `claude` |
 * | `OMNI_DEV_TRUST` | 默认会话的信任档，默认 `auto-edit` |
 * | `OMNI_DEV_RESUME` | 置 1 时不新建会话，而是续跑磁盘上最近的那个 |
 * | `OMNI_DEV_FIND` | 到点自动打开查找条并填入这段文字 |
 * | `OMNI_DEV_INTERRUPT` | 过这么多毫秒之后自动中断当前轮次 |
 * | `OMNI_DEV_RELOAD` | 过这么多毫秒之后强制重载渲染层（验证全量重建） |
 * | `OMNI_DEV_HANDOFF` | `<ms>:<引擎>`，到点把会话**接力**给这家 |
 * | `OMNI_DEV_FORK` | `<ms>:<引擎>`，到点**分叉**一份给这家（原会话保留） |
 * | `OMNI_DEV_SHOT` | 到点把窗口截成 PNG 写到这个路径，然后退出 |
 * | `OMNI_DEV_SHOT_DELAY` | 截图前等多少毫秒，默认 45000 |
 *
 * 用 `webContents.capturePage()` 而不是系统级截屏：只拍这个窗口，
 * 不需要录屏权限，也不会把桌面上的其他东西一起拍进去。
 */
export function devPrompt(): string | undefined {
  const text = process.env["OMNI_DEV_PROMPT"]
  return text === undefined || text === "" ? undefined : text
}

/**
 * 默认会话开在哪个目录。
 *
 * 不给就用 `process.cwd()`——但在 `pnpm dev` 下那是 `apps/desktop`，
 * 不是你以为的那个目录。验证时对着一个空目录跑，agent 会老老实实回答
 * 「这里没有那个文件」，看起来像驱动坏了，其实是工作区搞错了。踩过一次。
 */
export function devCwd(fallback: string): string {
  const dir = process.env["OMNI_DEV_CWD"]
  return dir === undefined || dir === "" ? fallback : dir
}

/** 换引擎跑一遍是验证归一化模型的主要手段，所以给它留了个口子。 */
export function devEngine(): string {
  const engine = process.env["OMNI_DEV_ENGINE"]
  return engine === undefined || engine === "" ? "claude" : engine
}

const TRUSTS = new Set<Trust>(["read-only", "auto-edit", "full"])

/** 验证运行态时常常需要一个不会被审批打断的档位，所以也留个口子。认不出就用默认。 */
export function devTrust(): Trust {
  const value = process.env["OMNI_DEV_TRUST"]
  return value !== undefined && TRUSTS.has(value as Trust) ? (value as Trust) : "auto-edit"
}

/** 续跑只能靠点按钮触发，自动化验证需要一个口子。 */
export function devResume(): boolean {
  return process.env["OMNI_DEV_RESUME"] === "1"
}

/**
 * 到点自动打开查找条。查找要按 ⌘F 才出得来，自动化截图按不了键。
 *
 * 走的是**和菜单同一条**通道，所以验证的是真链路，不是一条测试专用的旁路。
 */
export function scheduleDevFind(win: BrowserWindow): void {
  const query = process.env["OMNI_DEV_FIND"]
  if (query === undefined || query === "") return
  const delay = Number(process.env["OMNI_DEV_SHOT_DELAY"] ?? "45000") - 2500
  setTimeout(() => {
    if (!win.isDestroyed()) win.webContents.send("omni:menu", "find")
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.send("omni:devFind", query)
    }, 300)
  }, Math.max(0, delay))
}

/** 到点自动中断。中断只能靠点按钮或按快捷键触发，自动化验证需要一个口子。 */
export function scheduleDevInterrupt(win: BrowserWindow): void {
  const at = Number(process.env["OMNI_DEV_INTERRUPT"] ?? "0")
  if (!Number.isFinite(at) || at <= 0) return
  setTimeout(() => {
    if (!win.isDestroyed()) win.webContents.send("omni:menu", "interrupt")
  }, at)
}

/**
 * 到点强制重载渲染层。
 *
 * 这是验证事件流序号与全量重建的**唯一**自动化手段：重载会把渲染层的状态
 * 清空，只有主进程那份全量重建靠得住，界面才能恢复原样。
 * 手工按 ⌘R 也能复现，但复现不了「重载期间引擎还在产出事件」那一段。
 */
export function scheduleDevReload(win: BrowserWindow): void {
  const at = Number(process.env["OMNI_DEV_RELOAD"] ?? "0")
  if (!Number.isFinite(at) || at <= 0) return
  setTimeout(() => {
    if (!win.isDestroyed()) win.webContents.reload()
  }, at)
}

/** 到点自动接力或分叉。这两个动作只能靠点界面触发，自动化验证需要一个口子。 */
export function scheduleDevSwitch(
  win: BrowserWindow,
  run: (kind: "handoff" | "fork", to: string) => void,
): void {
  for (const [key, kind] of [
    ["OMNI_DEV_HANDOFF", "handoff"],
    ["OMNI_DEV_FORK", "fork"],
  ] as const) {
    const spec = process.env[key]
    if (spec === undefined || spec === "") continue
    const [msText, to] = spec.split(":")
    const at = Number(msText)
    if (!Number.isFinite(at) || to === undefined || to === "") continue
    setTimeout(() => {
      if (!win.isDestroyed()) run(kind, to)
    }, at)
  }
}

export function scheduleDevShot(win: BrowserWindow): void {
  const target = process.env["OMNI_DEV_SHOT"]
  if (target === undefined || target === "") return
  const delay = Number(process.env["OMNI_DEV_SHOT_DELAY"] ?? "45000")
  setTimeout(() => {
    void win.webContents
      .capturePage()
      .then((image) => writeFile(target, image.toPNG()))
      .then(() => {
        app.quit()
      })
      .catch((error: unknown) => {
        console.error("dev shot failed:", error)
        app.quit()
      })
  }, delay)
}
