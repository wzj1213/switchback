import { writeFile } from "node:fs/promises"
import { app, nativeTheme, type BrowserWindow } from "electron"
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
 * | `OMNI_DEV_COMPARE` | 过这么多毫秒之后打开分叉对比视图 |
 * | `OMNI_DEV_FILTER` | 截图前把焦点送进侧栏筛选框并打这段字 |
 * | `OMNI_DEV_SELECT` | 截图前点开输入区里第 N 个下拉（1 起） |
 * | `OMNI_DEV_ROWMENU` | 截图前在侧栏第 N 行上右键（1 起） |
 * | `OMNI_DEV_THEME` | `dark` / `light`，强制主题（深色那套平时没人看得见） |
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

/**
 * 到点把焦点送进侧栏筛选框并打一段字。
 *
 * 用 `insertText` 而不是模拟按键：它插进**当前获得焦点的可编辑元素**，
 * 所以这一条同时验了两件事——⌘K 有没有把焦点送对地方、筛选有没有生效。
 * 焦点没落在筛选框上的话，字会一个都进不去（或者跑进输入框里），一眼看得出来。
 */
export function scheduleDevFilter(win: BrowserWindow): void {
  const text = process.env["OMNI_DEV_FILTER"]
  if (text === undefined || text === "") return
  const delay = Number(process.env["OMNI_DEV_SHOT_DELAY"] ?? "45000") - 3000
  setTimeout(() => {
    if (win.isDestroyed()) return
    win.webContents.send("omni:menu", "filter-threads")
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.insertText(text)
    }, 400)
  }, Math.max(0, delay))
}

/**
 * 到点点开输入区里第 N 个下拉。
 *
 * 自绘浮层能截到图，原生 `<select>` 的弹出层截不到——**这本身就是换掉它的
 * 理由之一**。有了这个钩子，下拉长什么样才进得了自动化验证。
 */
export function scheduleDevOpenSelect(win: BrowserWindow): void {
  const nth = Number(process.env["OMNI_DEV_SELECT"] ?? "0")
  if (!Number.isFinite(nth) || nth <= 0) return
  const delay = Number(process.env["OMNI_DEV_SHOT_DELAY"] ?? "45000") - 2000
  setTimeout(() => {
    if (win.isDestroyed()) return
    void win.webContents.executeJavaScript(
      `document.querySelectorAll(".composer__bar .trigger")[${String(nth - 1)}]?.click()`,
    )
  }, Math.max(0, delay))
}

/**
 * 强制深浅色。深色那套 token 平时没人看得见，改动 CSS 之后**必须能验一眼**——
 * 靠改系统设置去验，等于永远不验。
 */
export function applyDevTheme(): void {
  const want = process.env["OMNI_DEV_THEME"]
  if (want !== "dark" && want !== "light") return
  nativeTheme.themeSource = want
}

/** 到点在渲染层跑一段 JS，把结果打进日志。排查用，平时不开。 */
export function scheduleDevProbe(win: BrowserWindow, log: (message: string) => void): void {
  const code = process.env["OMNI_DEV_PROBE"]
  if (code === undefined || code === "") return
  const delay = Number(process.env["OMNI_DEV_SHOT_DELAY"] ?? "45000") - 3000
  setTimeout(() => {
    if (win.isDestroyed()) return
    void win.webContents
      .executeJavaScript(code)
      .then((value: unknown) => {
        log(`probe: ${JSON.stringify(value)}`)
      })
      .catch((error: unknown) => {
        log(`probe 失败：${String(error)}`)
      })
  }, Math.max(0, delay))
}

/**
 * 到点在侧栏第 N 行上右键。
 *
 * 和 `OMNI_DEV_SELECT` 一个道理：菜单是浮层，不点开就进不了截图。
 */
export function scheduleDevRowMenu(win: BrowserWindow): void {
  const nth = Number(process.env["OMNI_DEV_ROWMENU"] ?? "0")
  if (!Number.isFinite(nth) || nth <= 0) return
  const delay = Number(process.env["OMNI_DEV_SHOT_DELAY"] ?? "45000") - 2000
  setTimeout(() => {
    if (win.isDestroyed()) return
    void win.webContents.executeJavaScript(
      `(() => {
        const row = document.querySelectorAll(".sidebar__list .row")[${String(nth - 1)}]
        if (!row) return
        const box = row.getBoundingClientRect()
        row.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true, clientX: box.left + 60, clientY: box.top + 12,
        }))
      })()`,
    )
  }, Math.max(0, delay))
}

/** 到点打开对比视图。和查找、中断一样，走的是**菜单同一条通道**，验的是真链路。 */
export function scheduleDevCompare(win: BrowserWindow): void {
  const at = Number(process.env["OMNI_DEV_COMPARE"] ?? "0")
  if (!Number.isFinite(at) || at <= 0) return
  setTimeout(() => {
    if (!win.isDestroyed()) win.webContents.send("omni:menu", "compare")
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
