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
