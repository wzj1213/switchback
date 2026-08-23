import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { app, ipcMain, nativeTheme } from "electron"
import {
  SETTINGS_DEFAULTS,
  type EnginePick,
  type Settings,
  type ThemeChoice,
} from "../shared/settings.js"
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
    theme:
      typeof it.theme === "string" && THEMES.has(it.theme)
        ? (it.theme as ThemeChoice)
        : DEFAULTS.theme,
    projects: strings(it.projects) ?? DEFAULTS.projects,
    pinned: strings(it.pinned) ?? DEFAULTS.pinned,
    pinnedThreads: strings(it.pinnedThreads) ?? DEFAULTS.pinnedThreads,
    threadOrder: order(it.threadOrder),
    projectOrder: strings(it.projectOrder) ?? DEFAULTS.projectOrder,
    // **只认字面的 `false`**：默认是开着的，所以「读不出来」要落到开，
    // 而不是像 `remote.enabled` 那样落到关——那边关掉是安全的一侧，这边不是
    pets: it.pets !== false,
    // 深空配色相反：**只认字面的 `true`**，读不出来就落到关（默认那侧）
    effortVoid: it.effortVoid === true,
    dsh: dsh(it.dsh),
    defaultEngine: typeof it.defaultEngine === "string" ? it.defaultEngine : DEFAULTS.defaultEngine,
    defaultTrust:
      typeof it.defaultTrust === "string" && TRUSTS.has(it.defaultTrust)
        ? (it.defaultTrust as Trust)
        : DEFAULTS.defaultTrust,
    projectIcons: icons(it.projectIcons),
    lastUsed: lastUsed(it.lastUsed),
    remote: remote(it.remote),
  }
}

/**
 * DSH 只有用户明确确认后才进入引擎清单。
 *
 * **只认字面的 `true`**：这项会让一个能执行工具的引擎出现在新会话入口里；
 * 旧文件没有它、字段写坏了，都应该落回「尚未接入」。
 */
function dsh(raw: unknown): Settings["dsh"] {
  if (typeof raw !== "object" || raw === null) return DEFAULTS.dsh
  return { configured: (raw as Record<string, unknown>).configured === true }
}

/**
 * 远程访问的那几项。
 *
 * **`enabled` 只认字面的 `true`**：这是一个把服务端打开的开关，
 * 一个坏掉的值（`"yes"`、`1`）不该被当成「开」。同理 `maxTrust` 认不出就回默认，
 * 绝不落到最宽的那一档——档位判定里「查不到就放行」正是最典型的那类洞。
 *
 * `trustedHosts` 在这里只做「是不是字符串数组」，**形状校验留给启动时**
 * （`assertTrustedAuthority`）：那里失败要大声，而这里失败只会静默丢掉一条，
 * 于是用户看到的是「配了但一直 403」。
 */
function remote(raw: unknown): Settings["remote"] {
  if (typeof raw !== "object" || raw === null) return DEFAULTS.remote
  const it = raw as Record<string, unknown>
  const port =
    typeof it.port === "number" && Number.isInteger(it.port) && it.port >= 0 && it.port <= 65535
      ? it.port
      : DEFAULTS.remote.port
  return {
    enabled: it.enabled === true,
    port,
    trustedHosts: (strings(it.trustedHosts) ?? DEFAULTS.remote.trustedHosts).map(authorityOf),
    maxTrust:
      typeof it.maxTrust === "string" && TRUSTS.has(it.maxTrust)
        ? (it.maxTrust as Trust)
        : DEFAULTS.remote.maxTrust,
  }
}

/**
 * 把 `https://host:port` 收成 `host:port`。
 *
 * **这一条是踩出来的。** 那一栏要填的是隧道那头的域名，而人手上现成的那一串
 * 恰恰是**手机上打开的完整地址**——粘进去带着 `https://` 是最自然的动作，
 * 不是打错。而闸门比的是 `Host` 头，那里面从来没有 scheme，于是一路 403。
 *
 * 只脱 scheme，**别的一概不动**：带路径的（`host/path`）仍然要大声失败，
 * 因为那说明人理解错了这一栏是什么——`host/path` 会把整个主机名授权出去，
 * 而他以为自己只授权了那条路径。**能猜准的替他做，猜不准的当面说。**
 */
function authorityOf(entry: string): string {
  const m = /^https?:\/\/([^/?#]+)\/?$/iu.exec(entry.trim())
  return m?.[1] ?? entry.trim()
}

/** 一串字符串。不是数组、或者混进了别的类型，就当没有。 */
function strings(raw: unknown): readonly string[] | undefined {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : undefined
}

/**
 * 每个项目内会话的手动顺序：路径 → 会话 id 数组。
 *
 * 偏好文件是可以手改的，所以这里一样要过滤。**空数组的项直接丢掉**：
 * 「这个项目排过序，但顺序是空的」没有意义，留着只会让排序逻辑多一个分支。
 */
function order(raw: unknown): Record<string, readonly string[]> {
  if (typeof raw !== "object" || raw === null) return {}
  const out: Record<string, readonly string[]> = {}
  for (const [cwd, ids] of Object.entries(raw as Record<string, unknown>)) {
    const list = strings(ids)
    if (list === undefined || list.length === 0) continue
    out[cwd] = list
  }
  return out
}

/**
 * 项目图标：路径 → emoji。
 *
 * **限长两个字素**。不限的话这里就成了一个「往侧栏塞任意字符串」的口子——
 * 偏好文件是可以手改的，而侧栏那一列宽度固定，塞进去一段长文本会把整列挤垮。
 * 两个是因为有些 emoji 带修饰符（肤色、ZWJ 组合），一个字素装不下。
 */
function icons(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null) return {}
  const out: Record<string, string> = {}
  for (const [cwd, icon] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof icon !== "string" || icon === "") continue
    if ([...new Intl.Segmenter().segment(icon)].length > 2) continue
    out[cwd] = icon
  }
  return out
}

/**
 * 上次开工用的那一套。
 *
 * **模型/思维档只做「是不是字符串」的校验，不做白名单**：那份名单在引擎那边，
 * 而且随版本变。写死一份的下场是引擎升级出了新模型，omni 这边把它当脏数据丢掉。
 * 认不出来的模型引擎自己会拒，那时用户看到的是引擎的原话——比我们编一句准。
 */
function lastUsed(raw: unknown): Settings["lastUsed"] {
  if (typeof raw !== "object" || raw === null) return DEFAULTS.lastUsed
  const it = raw as Record<string, unknown>
  const byEngine: Record<string, EnginePick> = {}
  if (typeof it.byEngine === "object" && it.byEngine !== null) {
    for (const [engine, raw2] of Object.entries(it.byEngine as Record<string, unknown>)) {
      const pick = enginePick(raw2)
      if (pick !== undefined) byEngine[engine] = pick
    }
  }
  return { engine: typeof it.engine === "string" ? it.engine : "", byEngine }
}

/** 一家引擎上次选的模型/思维档。**两项都没有的空壳不留**——留着只会让读的一方多判一次。 */
function enginePick(raw: unknown): EnginePick | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const it = raw as Record<string, unknown>
  const model = typeof it.model === "string" ? it.model : undefined
  const effort = typeof it.effort === "string" ? it.effort : undefined
  if (model === undefined && effort === undefined) return undefined
  return { ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) }
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
export function installSettingsChannel(
  store: Store,
  onPatch?: (before: Settings, after: Settings) => void,
): void {
  ipcMain.handle("omni:settings", (_e, patch?: Partial<Settings>) => {
    if (patch === undefined) return store.get()
    const before = store.get()
    const after = store.patch(patch)
    onPatch?.(before, after)
    return after
  })
}

// 主进程别处（主题、菜单）还按老路径引，这里再导出一次，避免一次性大改
export type { Settings, ThemeChoice } from "../shared/settings.js"
