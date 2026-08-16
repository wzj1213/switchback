import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { app, ipcMain, nativeTheme } from "electron"
import { SETTINGS_DEFAULTS, type Settings, type ThemeChoice } from "../shared/settings.js"
import type { Trust } from "@omni/protocol"
import type { Logger } from "./log.js"

/**
 * 用户偏好。
 *
 * ## 和 `engines.json` 分开存
 *
 * 那份是**用户手写**的配置（第三方引擎注册表），这份是**界面写**的偏好
 * （主题、置顶了哪些项目、新会话默认用什么）。混在一个文件里，
 * 界面每改一次主题就会把用户手写的注释和格式冲掉一次。
 *
 * ## 为什么不放 localStorage
 *
 * 置顶和默认档位要在**新开的窗口**里也生效，而 localStorage 是渲染进程的。
 * 更要紧的是信任档：它的默认值决定新会话开在哪一档上，
 * 那是安全相关的决定，不该存在一个清一次浏览器缓存就没了的地方。
 */

const DEFAULTS: Settings = SETTINGS_DEFAULTS

const FILE = "settings.json"
const TRUSTS: ReadonlySet<string> = new Set(["read-only", "auto-edit", "full"])
const THEMES: ReadonlySet<string> = new Set(["system", "light", "dark"])

function pathOf(): string {
  return join(app.getPath("userData"), FILE)
}

/**
 * 逐字段校验，**不整份信任**。
 *
 * 这个文件用户改得到，也可能是上一个版本写的。一个坏掉的 `defaultTrust`
 * 如果被原样吃进去，新会话就会开在一个不存在的档位上——而信任档判定
 * 查不到就落到最宽的那一档，那是安全问题。所以认不出的一律回落到默认。
 */
function parse(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null) return DEFAULTS
  const it = raw as Partial<Record<keyof Settings, unknown>>
  return {
    theme: typeof it.theme === "string" && THEMES.has(it.theme) ? (it.theme as ThemeChoice) : DEFAULTS.theme,
    pinned: Array.isArray(it.pinned) ? it.pinned.filter((x): x is string => typeof x === "string") : DEFAULTS.pinned,
    defaultEngine: typeof it.defaultEngine === "string" ? it.defaultEngine : DEFAULTS.defaultEngine,
    defaultTrust:
      typeof it.defaultTrust === "string" && TRUSTS.has(it.defaultTrust)
        ? (it.defaultTrust as Trust)
        : DEFAULTS.defaultTrust,
  }
}

export interface Store {
  get: () => Settings
  /** 合并写入。返回合并后的完整值，渲染层拿它直接更新界面。 */
  patch: (next: Partial<Settings>) => Settings
}

export function createSettings(log: Logger): Store {
  let current = DEFAULTS
  try {
    current = parse(JSON.parse(readFileSync(pathOf(), "utf8")) as unknown)
  } catch {
    // 没有这个文件是常态（第一次启动），不值得记一条日志
  }
  // 主题要在窗口建出来之前就定下来，否则会先闪一下系统色
  nativeTheme.themeSource = current.theme

  const save = (): void => {
    try {
      writeFileSync(pathOf(), `${JSON.stringify(current, null, 2)}\n`, "utf8")
    } catch (error) {
      // 存不下就存不下，**绝不能因此掀翻应用**——偏好没那么重要
      log.write("warn", "settings", `写不进 ${FILE}：${String(error)}`)
    }
  }

  return {
    get: () => current,
    patch: (next) => {
      current = parse({ ...current, ...next })
      nativeTheme.themeSource = current.theme
      save()
      return current
    },
  }
}

/** 渲染层读写偏好的通道。 */
export function installSettingsChannel(store: Store): void {
  ipcMain.handle("omni:settings", (_e, patch?: Partial<Settings>) =>
    patch === undefined ? store.get() : store.patch(patch),
  )
}

// 主进程别处（主题、菜单）还按老路径引，这里再导出一次，避免一次性大改
export type { Settings, ThemeChoice } from "../shared/settings.js"
