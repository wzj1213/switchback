import type { Trust } from "@switchback/protocol"
import type { WireBytes } from "@switchback/wire"
import type { Handler } from "../channels.js"
import { judgeCall } from "./exposure.js"
import type { CallOutcome } from "./session-calls.js"
import type { Device, DeviceKind, TokenStore } from "./tokens.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { REMOTE_CALLER } from "./calls.messages.js"

/**
 * 一台设备发来的调用，在宿主这侧怎么落地：**现查记录 → 判 → 找处理函数 → 调**。
 *
 * 每一步都现做，不在连接建立时拍一张快照：设备可能在连着的时候被吊销、被调低上限，
 * 而那一刻之后的每一次调用都必须按新的来。
 */

export interface CallerDeps {
  tokens: Pick<TokenStore, "get">
  /** 设备没有自己的上限时用的那条（`settings.remote.maxTrust`）。 */
  defaultTrust: () => Trust
  /** 按名字找处理函数（`main/channels.ts`）。没给 = 这台宿主不接受任何调用。 */
  find?: (name: string) => Handler | undefined
  /** 宿主的界面语言：拒的理由照它说。缺省＝默认的中文。 */
  language?: () => Locale
  log: (level: "info" | "warn" | "error", message: string) => void
}

/** 设备记录里没写种类的是手机端（那个字段出现之前配的全是手机）。 */
export function kindOf(device: Pick<Device, "kind"> | undefined): DeviceKind {
  return device?.kind ?? "phone"
}

/** 这台设备**这一刻**的上限：它自己的，没有就跟着全局。 */
export function trustOf(device: Pick<Device, "maxTrust"> | undefined, fallback: Trust): Trust {
  return device?.maxTrust ?? fallback
}

function isWireBytes(value: unknown): value is WireBytes {
  return typeof value === "object" && value !== null && typeof (value as Partial<WireBytes>).$bytes === "string"
}

/**
 * 线上的 `{ $bytes }` 还原成 `Buffer`。**只看参数第一层**——通道的参数本来就是扁平的一层对象，
 * 往深里递归只会多一个要设防的面（`@switchback/wire` 的 `WireBytes`）。
 */
export function unpackBytes(arg: unknown): unknown {
  if (typeof arg !== "object" || arg === null || Array.isArray(arg)) return arg
  return Object.fromEntries(
    Object.entries(arg).map(([key, value]) => [key, isWireBytes(value) ? Buffer.from(value.$bytes, "base64") : value]),
  )
}

/** 给一台设备造它的 `call`。 */
export function callFor(deps: CallerDeps, deviceId: string): (method: string, arg: unknown) => Promise<CallOutcome> {
  return async (method, arg) => {
    const locale = deps.language?.() ?? DEFAULT_LOCALE
    const device = deps.tokens.get(deviceId)
    if (device === undefined) return { ok: false, reason: REMOTE_CALLER[locale].revoked }
    const verdict = judgeCall(method, arg, { kind: kindOf(device), maxTrust: trustOf(device, deps.defaultTrust()) }, locale)
    if (!verdict.ok) {
      deps.log("info", `${device.name} 调 ${method} 被拒：${verdict.reason}`)
      return verdict
    }
    const handler = deps.find?.(method)
    // 白名单里有、表上却没有：宿主自己漏挂了（见 `main/index.ts` 启动时那条自查）
    if (handler === undefined) return { ok: false, reason: REMOTE_CALLER[locale].noChannel(method) }
    return { ok: true, value: await handler(unpackBytes(arg)) }
  }
}
