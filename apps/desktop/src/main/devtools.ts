import { writeFile } from "node:fs/promises"
import { app, type BrowserWindow } from "electron"
import type { Trust } from "@omni/protocol"

/**
 * 开发期用的自动化钩子，**全部由环境变量开关，默认完全不生效**。
 *
 * | 变量 | 作用 |
 * | --- | --- |
 * | `OMNI_DEV_PROMPT` | 默认会话建好后自动发这条提示词 |
 * | `OMNI_DEV_ENGINE` | 默认会话用哪个引擎，默认 `claude` |
 * | `OMNI_DEV_TRUST` | 默认会话的信任档，默认 `auto-edit` |
 * | `OMNI_DEV_RESUME` | 置 1 时不新建会话，而是续跑磁盘上最近的那个 |
 * | `OMNI_DEV_FIND` | 到点自动打开查找条并填入这段文字 |
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
