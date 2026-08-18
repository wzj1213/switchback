import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto"
import type { PushSubscription } from "./push.js"

/**
 * 设备令牌与配对码。「你是谁」这一层。
 *
 * ## 为什么是配对码换长期令牌，而不是一个密码
 *
 * 密码要么弱到能猜，要么记不住于是被存在别处；而且**一个密码没法只吊销一台设备**。
 * 配对码这套是 codex remote-control 的形状（`pair` / `pair/status` / `client/revoke`）：
 * 短期一次性的码只用来换一次身份，之后每台设备各拿各的长期令牌，丢了手机就吊销那一条。
 *
 * ## 只存哈希
 *
 * 磁盘上（以及备份里、诊断报告里）留的是 sha256，不是令牌原文。
 * 令牌有 256 位熵，所以不需要 bcrypt 那种慢哈希——爆破的成本在熵那里，不在哈希这里。
 */

/** 一台配过对的设备。 */
export interface Device {
  id: string
  /** 给人看的名字。设备自己报，宿主不核实——它只用来让你在吊销时认出是哪台。 */
  name: string
  /** 令牌的 sha256（hex）。**原文不落盘。** */
  hash: string
  createdAt: number
  lastSeenAt: number
  /**
   * 这台设备的推送订阅。**挂在设备记录上，不另开一张表**——
   * 吊销一台设备就该连带停止推给它，一条记录一个生命周期，没有第二处要记得清。
   */
  push?: PushSubscription
}

export interface TokenDeps {
  load: () => readonly Device[]
  save: (devices: readonly Device[]) => void
  now: () => number
}

/** 配对码的有效期。够你从桌面看一眼再在手机上打完，短到来不及被翻出来用。 */
const CODE_TTL_MS = 5 * 60_000

/** 认错几次就锁多久。防的是拿着 32^8 的空间慢慢试。 */
const MAX_FAILURES = 10
const LOCKOUT_MS = 60_000

/** 去掉了形近字符（0/O、1/I/l）——这串是要用眼睛读、用手打的。 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
const CODE_LEN = 8

export type ClaimResult = { ok: true; token: string; device: Device } | { ok: false; reason: string }

export interface Pairing {
  code: string
  expiresAt: number
}

export interface TokenStore {
  /** 开一次配对。**新的一开，上一个就作废**——同时挂着两个有效码没有任何好处。 */
  startPairing: () => Pairing
  /** 现在挂着的配对码；没有或已过期时 undefined。桌面端据此显示/隐藏那块面板。 */
  pending: () => Pairing | undefined
  /** 取消当前配对。 */
  cancelPairing: () => void
  /** 用配对码换一个长期令牌。 */
  claim: (code: string, name: string) => ClaimResult
  /** 校验令牌，顺带记一次「最后见到」。认不出返回 undefined。 */
  verify: (token: string) => Device | undefined
  list: () => readonly Device[]
  /** 记下（或换掉）一台设备的推送订阅。设备不存在时什么都不做，返回 false。 */
  setPush: (id: string, push: PushSubscription | undefined) => boolean
  /** 现在能推给谁。只回有订阅的那些。 */
  pushable: () => readonly { id: string; name: string; push: PushSubscription }[]
  /** 吊销一台。返回有没有真的删掉一条。 */
  revoke: (id: string) => boolean
  revokeAll: () => void
}

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** 定长比较。哈希本身不可逆，但白送的旁路没有理由留着。 */
function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex")
  const right = Buffer.from(b, "hex")
  return left.length === right.length && timingSafeEqual(left, right)
}

function newCode(): string {
  return Array.from({ length: CODE_LEN }, () => ALPHABET[randomInt(ALPHABET.length)] ?? "2").join("")
}

interface State {
  devices: Device[]
  pairing: Pairing | undefined
  failures: number
  lockedUntil: number
}

/** 认错一次。攒够就锁一段时间，**并把计数清零**——否则锁完第一次就永远锁着。 */
function noteFailure(state: State, now: number): ClaimResult {
  state.failures += 1
  if (state.failures >= MAX_FAILURES) {
    state.lockedUntil = now + LOCKOUT_MS
    state.failures = 0
  }
  return { ok: false, reason: "配对码不对或已过期" }
}

function mint(state: State, name: string, now: number, flush: () => void): ClaimResult {
  const token = randomBytes(32).toString("base64url")
  const device: Device = {
    id: randomBytes(8).toString("hex"),
    name: name.trim().slice(0, 60) || "未命名设备",
    hash: hashOf(token),
    createdAt: now,
    lastSeenAt: now,
  }
  state.devices.push(device)
  flush()
  return { ok: true, token, device }
}

/** 记下（或清掉）一台设备的推送订阅。**提到外面**：`createTokenStore` 已经贴着行数闸门。 */
function setPush(state: State, id: string, push: PushSubscription | undefined, flush: () => void): boolean {
  const device = state.devices.find((d) => d.id === id)
  if (device === undefined) return false
  if (push === undefined) delete device.push
  else device.push = push
  flush()
  return true
}

/** 现在能推给谁。 */
function pushable(state: State): readonly { id: string; name: string; push: PushSubscription }[] {
  return state.devices
    .filter((d): d is Device & { push: PushSubscription } => d.push !== undefined)
    .map((d) => ({ id: d.id, name: d.name, push: d.push }))
}

/** 认一个令牌，顺带记一次「最后见到」。**提到外面**：`createTokenStore` 贴着行数闸门。 */
function verify(state: State, token: string, now: number, flush: () => void): Device | undefined {
  if (token === "") return undefined
  const hash = hashOf(token)
  const device = state.devices.find((d) => sameHash(d.hash, hash))
  if (device === undefined) return undefined
  device.lastSeenAt = now
  flush()
  return device
}

export function createTokenStore(deps: TokenDeps): TokenStore {
  const state: State = { devices: [...deps.load()], pairing: undefined, failures: 0, lockedUntil: 0 }

  const flush = (): void => {
    deps.save(state.devices)
  }

  const livePairing = (): Pairing | undefined => {
    if (state.pairing === undefined) return undefined
    if (deps.now() >= state.pairing.expiresAt) {
      state.pairing = undefined
      return undefined
    }
    return state.pairing
  }

  const claim = (code: string, name: string): ClaimResult => {
    const now = deps.now()
    if (now < state.lockedUntil) return { ok: false, reason: "配对码试错太多次，先等一分钟" }
    const pairing = livePairing()
    // **码不对和没在配对，回同一句话**——分开说等于告诉对方「现在有码可试」
    if (pairing === undefined || !constantEqual(code.trim().toUpperCase(), pairing.code)) {
      return noteFailure(state, now)
    }
    // 用掉就作废：一个码只换一台设备
    state.pairing = undefined
    state.failures = 0
    return mint(state, name, now, flush)
  }

  return {
    startPairing: () => {
      const pairing = { code: newCode(), expiresAt: deps.now() + CODE_TTL_MS }
      state.pairing = pairing
      state.failures = 0
      return pairing
    },
    pending: livePairing,
    cancelPairing: () => {
      state.pairing = undefined
    },
    claim,
    verify: (token) => verify(state, token, deps.now(), flush),
    list: () => state.devices.map((d) => ({ ...d })),
    setPush: (id, push) => setPush(state, id, push, flush),
    pushable: () => pushable(state),
    revoke: (id) => {
      const before = state.devices.length
      state.devices = state.devices.filter((d) => d.id !== id)
      if (state.devices.length === before) return false
      flush()
      return true
    },
    revokeAll: () => {
      state.devices = []
      flush()
    },
  }
}

/**
 * 配对码的定长比较。
 *
 * **先编码再比长度。** 反过来（比 UTF-16 码元长度、再按 UTF-8 编码交给
 * `timingSafeEqual`）有一个能被利用的洞：`ÀÀÀÀÀÀÀÀ` 是 8 个码元但 16 个字节，
 * 长度检查放行、`timingSafeEqual` 因两边字节数不等**抛异常**。而这一句
 * 只在「正在配对」时才求值（`claim` 里那个短路），于是异常一路冒到
 * HTTP 层变成 500——没配对时是 403。两个状态码就成了「桌面上现在有没有
 * 挂着一个五分钟有效的码」的判别器，正好推翻本文件刻意维持的那条不变量。
 * 更糟的是它抛在计数之前，探测本身不算失败次数，可以无限轮询。
 */
function constantEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  return left.length === right.length && timingSafeEqual(left, right)
}
