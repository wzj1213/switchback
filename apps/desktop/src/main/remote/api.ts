import type { IncomingMessage, ServerResponse } from "node:http"
import { hostname } from "node:os"
import type { Trust } from "@switchback/protocol"
import type { Locale } from "@switchback/i18n"
import { kindOf, trustOf } from "./calls.js"
import type { TokenStore } from "./tokens.js"
import { REMOTE_API } from "./api.messages.js"

/**
 * 远程服务端那几条普通 HTTP 接口：配对、我是谁、推送订阅。
 *
 * 从 `server.ts` 拆出来是行数闸门逼的，但边界也讲得通：那边管**连接**（升级、心跳、
 * 吊销时掐线），这边管**一问一答**。两边共用同一道闸（`fence.ts`）——闸在路由里过，
 * 走到这里的请求已经是冲着我们来的。
 */

/** 配对请求的体积上限。它只有两个短字段，给这么多已经是宽的。 */
const MAX_BODY = 4096

export interface ApiDeps {
  tokens: TokenStore
  /** 全局上限。设备没有自己的上限时，「我是谁」报的就是这条。 */
  maxTrust: () => Trust
  /** 宿主的界面语言。「我是谁」带上它，网页端照着它说话。 */
  language: () => Locale
  log: (level: "info" | "warn" | "error", message: string) => void
}

export function json(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  })
  res.end(text)
}

/** 读请求体，超过上限就掐断。**不 buffer 无限大的东西**。 */
async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > MAX_BODY) return undefined
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString("utf8")
}

/** `Authorization: Bearer xxx` 里的令牌。 */
export function bearer(req: IncomingMessage): string {
  const raw = req.headers.authorization
  return typeof raw === "string" && raw.startsWith("Bearer ") ? raw.slice(7) : ""
}

export async function handlePair(deps: ApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const m = REMOTE_API[deps.language()]
  const body = await readBody(req)
  if (body === undefined) {
    json(res, 413, { error: m.tooLarge })
    return
  }
  const parsed = safeParse(body)
  const code = typeof parsed?.["code"] === "string" ? parsed["code"] : ""
  const name = typeof parsed?.["name"] === "string" ? parsed["name"] : ""
  const claimed = deps.tokens.claim(code, name.trim() === "" ? m.unnamed : name)
  if (!claimed.ok) {
    deps.log("warn", `配对失败：${claimed.reason}`)
    json(res, 403, { error: m.refused[claimed.reason] })
    return
  }
  deps.log("info", `新设备配对成功：${claimed.device.name}（${claimed.device.id}）`)
  json(res, 200, { token: claimed.token, device: { id: claimed.device.id, name: claimed.device.name } })
}

/**
 * 记下一台设备的推送订阅。
 *
 * **要带令牌**：订阅是「往这台设备推」的凭据，谁都能写的话，
 * 任何人都能让 Switchback 把你的会话标题推到他自己的手机上。
 */
export async function handleSubscribe(deps: ApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const device = deps.tokens.verify(bearer(req))
  if (device === undefined) {
    json(res, 401, { error: "unauthorized" })
    return
  }
  const body = await readBody(req)
  if (body === undefined) {
    json(res, 413, { error: REMOTE_API[deps.language()].tooLarge })
    return
  }
  const parsed = safeParse(body ?? "")
  // 传 null 表示退订。三个字段缺一不可——半个订阅推不出去，留着只会每次白发一次请求
  if (parsed?.["endpoint"] === undefined) {
    deps.tokens.setPush(device.id, undefined)
    deps.log("info", `${device.name} 取消了推送`)
    json(res, 200, { ok: true })
    return
  }
  const endpoint = parsed["endpoint"]
  const p256dh = parsed["p256dh"]
  const auth = parsed["auth"]
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
    json(res, 400, { error: REMOTE_API[deps.language()].badSubscription })
    return
  }
  deps.tokens.setPush(device.id, { endpoint, p256dh, auth })
  deps.log("info", `${device.name} 开了推送`)
  json(res, 200, { ok: true })
}

function safeParse(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/**
 * 「我是谁」。
 *
 * `host` 是**连接级常量**，不是事件流里刚发生的一件事——所以走这条路由，
 * 不新增一种帧（那样每次全量重建都要重发一遍，还要顾 `scopeReplay` 的字节预算）。
 * 手机上「引擎跑在那台 Mac 上」解释了一大堆事：为什么没有「在访达中显示」、
 * 为什么信任档被钳住、为什么关掉手机它照样在跑。
 */
export function handleMe(deps: ApiDeps, req: IncomingMessage, res: ServerResponse): void {
  const device = deps.tokens.verify(bearer(req))
  if (device === undefined) {
    json(res, 401, { error: "unauthorized" })
    return
  }
  json(res, 200, {
    id: device.id,
    name: device.name,
    // **报这台设备自己的上限**，不是全局那条——两者不同时，界面说的必须是真正钳住它的那条
    maxTrust: trustOf(device, deps.maxTrust()),
    kind: kindOf(device),
    host: hostname(),
    language: deps.language(),
  })
}
