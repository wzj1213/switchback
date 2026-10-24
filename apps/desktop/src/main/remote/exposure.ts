import type { Trust } from "@switchback/protocol"
import type { DeviceKind } from "./tokens.js"
import type { Locale } from "@switchback/i18n"
import { REMOTE_EXPOSURE } from "./exposure.messages.js"

/**
 * 远程模式里，另一台电脑上的桌面界面**能调哪几条宿主通道**（`docs/远程模式方案.md` §2.2）。
 *
 * ## 为什么是白名单，而命令那边是钳档位
 *
 * 命令（`policy.ts`）再多，也只能让引擎在某条会话里动；档位钳住了，权限面就钳住了。
 * **通道钳不住**：`tryAcpEngine` 在宿主上执行任意程序，`selfUpdate` 重建并替换宿主自己，
 * `remote/pair` 能造新设备，设置的写能把远程上限自己调到完全档。
 * 所以这里反过来：**表里没有的一律拒**。新加一条通道默认不暴露；
 * 要暴露就来这张表里加一行，而加这一行是要过评审的事。
 *
 * ## 两档
 *
 * - `read`：只看不改。任何按「电脑」配对的设备都能调。
 * - `write`：改工作区或宿主上的文件（提交、暂存、贴图落盘、存草稿…）。
 *   **设备上限是只读时拒**——它不能让引擎改文件，也就不该能替引擎提交。
 *
 * 纯表 + 纯函数，不碰 IO：判定要能被一张表穷举测试。
 */
export type Rule = "read" | "write"

export const EXPOSED: Readonly<Record<string, Rule>> = {
  // 读的那一半；写由 `PREF_KEYS` 单独判（见 `judgeSettings`）
  "switchback:settings": "read",
  "switchback:appInfo": "read",
  "switchback:worksite": "read",
  "switchback:workReview": "read",
  "switchback:workPatch": "read",
  "switchback:gitState": "read",
  "switchback:searchThreads": "read",
  "switchback:searchFiles": "read",
  "switchback:filePreview": "read",
  "switchback:projectDoc": "read",
  "switchback:thumb": "read",
  "switchback:activity": "read",
  "switchback:engineVersions": "read",
  "switchback:engineDoors": "read",
  "switchback:dshProfiles": "read",
  "switchback:envConfig": "read",
  "switchback:guard": "read",
  "switchback:drafts/load": "read",
  "switchback:gitCommit": "write",
  "switchback:gitStage": "write",
  "switchback:gitUndo": "write",
  "switchback:ensureProjectDoc": "write",
  "switchback:stashImage": "write",
  "switchback:discardImages": "write",
  "switchback:drafts/save": "write",
  // 在 `~/Documents/Switchback/` 下建一个目录
  "switchback:chatDir": "write",
}

/**
 * 远程能写的设置键：**只有界面偏好**。
 *
 * 不在这里的——`remote`（把自己的上限调到完全档）、`egressStop`（关外发守卫）、
 * `zcodeLock`、`disabledEngines`（启用一家被停用的引擎）、`defaultTrust`、`dsh`、
 * `notify`、`handoffBrief`——都是**宿主上的决定**，去那台机器上改。
 *
 * **`theme` 也不在**，理由不一样：它在宿主上是经 `nativeTheme` 生效的，改的是**宿主窗口**的明暗；
 * 远程窗口跟着自己那台电脑的系统走。放行的话，远程这头点了「深色」自己屏幕上什么都不变，
 * 宿主那台却翻了——两头都错。
 */
export const PREF_KEYS: ReadonlySet<string> = new Set([
  "projects",
  "pinned",
  "pinnedThreads",
  "threadOrder",
  "projectOrder",
  "projectIcons",
  "lastUsed",
  "panes",
  "pets",
  "petKit",
])

export interface Caller {
  kind: DeviceKind
  /** 这台设备**现在**的上限（设备自己的，缺省时是全局那条）。 */
  maxTrust: Trust
}

export type Verdict = { ok: true } | { ok: false; reason: string }

const refuse = (reason: string): Verdict => ({ ok: false, reason })

/**
 * 设置的写：整条 patch 里**只要有一个键不在白名单就整条拒**。
 * 放行一半等于让界面以为全写进去了——它拿回去的那份完整设置里，被丢掉的那几项还是旧值，
 * 而界面上的开关已经拨过去了。
 */
function judgeSettings(patch: unknown, m: (typeof REMOTE_EXPOSURE)[Locale]): Verdict {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    return refuse(m.notObject)
  }
  const blocked = Object.keys(patch).filter((key) => !PREF_KEYS.has(key))
  if (blocked.length === 0) return { ok: true }
  // 拒的时候说人能看懂的名字；没列到的键照原样说——总比一句「有些键不行」强
  const labels: Readonly<Record<string, string>> = m.keys
  return refuse(m.hostOnly(blocked.map((key) => (Object.hasOwn(labels, key) ? labels[key] : undefined) ?? key)))
}

/**
 * 这台设备能不能调这条通道。
 *
 * **查表必须查自有属性**：`EXPOSED["__proto__"]` 拿到的是 `Object.prototype`——
 * 一个真值（`policy.ts` 的 `shapeOf` 踩过同一个坑）。
 */
export function judgeCall(method: string, arg: unknown, caller: Caller, locale: Locale): Verdict {
  const m = REMOTE_EXPOSURE[locale]
  if (caller.kind !== "desk") {
    return refuse(m.phone)
  }
  const rule = Object.hasOwn(EXPOSED, method) ? EXPOSED[method] : undefined
  if (rule === undefined) return refuse(m.hostOnlyCall(method))
  if (method === "switchback:settings" && arg !== undefined) return judgeSettings(arg, m)
  if (rule === "write" && caller.maxTrust === "read-only") {
    return refuse(m.readOnly)
  }
  return { ok: true }
}
