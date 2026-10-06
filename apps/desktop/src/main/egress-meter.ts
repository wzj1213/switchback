import type { EgressRecord } from "../shared/guard.js"
import type { Traffic } from "./egress-sample.js"

export type { EgressRecord }

/**
 * 外发守卫「判」的那一半：每个被盯着的进程树，一分钟里**它自己**往本机外面发了多少。
 *
 * ## 为什么是这个量
 *
 * 模型对话的上行是一次次请求：一次把整段上下文发出去，常见几十到几百 KB，
 * 一百万 token 的上下文也就四 MB 上下；一分钟十几次请求到头了。
 * 而把一个仓库连同 `.git` 打包上传是另一个量级——ZCode 那次一个包 313 MB，86.6% 是 `.git`。
 * 所以一分钟 64 MB 这条线：正常对话碰不到，整仓打包过不去。
 *
 * ## 为什么只数「它自己」
 *
 * 模型调一条 `git push`、`npm publish` 也会往外发一大堆——那是它当着你的面跑的命令，
 * 转录区里写着，是你让它做的事。这里要抓的是**没人看见的那种**：引擎进程自己在后台发。
 * 它跑的命令照样记账（给你看），只是不拿来判。
 *
 * 纯逻辑：时刻由调用方传入，账本原地改。
 */

export const WINDOW_MS = 60_000
export const LIMIT_BYTES = 64 * 1024 * 1024
/** 同一个进程报过一次之后，这么久之内不再报第二次：一次大上传会连着好几拍都超线。 */
const COOLDOWN_MS = 5 * 60_000

/** 一个被盯着的进程树。 */
export interface Watched {
  /** 稳定的键：同一个进程每一拍都一样。 */
  key: string
  /** 给人看的名字（`Claude Code`、`ZCode`）。 */
  label: string
  /** 用着它的会话（kimi web 这种一个进程供几条会话）。不是 Switchback 起的进程就是空的。 */
  threads: readonly string[]
  leader: number
  runtime: readonly number[]
  tools: readonly number[]
}


export interface EgressAlert {
  key: string
  label: string
  threads: readonly string[]
  leader: number
  runtime: readonly number[]
  /** 这一分钟里它自己发出去的字节。 */
  bytes: number
}

/** 一拍看到的东西。 */
export interface Sample {
  watched: readonly Watched[]
  /** 每个有过外部流量的进程到这一刻的累计值（`nettop`）。 */
  traffic: ReadonlyMap<number, Traffic>
  /** 这一刻还活着的全部 pid（`ps`）。死了的才从底数表里摘掉。 */
  living: ReadonlySet<number>
}

export interface EgressMeter {
  /** 一分钟里它自己发到多少算批量。默认 `LIMIT_BYTES`；开发时可以调低了演一遍（见 `egress-guard.ts`）。 */
  limit: number
  /**
   * 每个 pid 上一拍的累计值——**所有有外部流量的进程都记，不只盯着的那几个**：
   * 一个跑了几个小时的引擎哪天才进盯着的名单（会话刚接上），它此前发过的不该一下子全算进这一分钟。
   * **第一拍只记底数**：守卫刚起的时候，之前发过的不算。
   */
  seen: Map<number, Traffic>
  primed: boolean
  windows: Map<string, { at: number; bytes: number }[]>
  records: Map<string, EgressRecord>
  alerted: Map<string, number>
}

export function createEgressMeter(limit: number = LIMIT_BYTES): EgressMeter {
  return { limit, seen: new Map(), primed: false, windows: new Map(), records: new Map(), alerted: new Map() }
}

/** 一拍：吃进这一刻每个进程的累计值，返回这一拍新超线的那几个。 */
export function observe(meter: EgressMeter, now: number, sample: Sample): EgressAlert[] {
  const delta = deltasOf(meter, sample.traffic, sample.living)
  const alerts: EgressAlert[] = []
  for (const w of sample.watched) {
    const own = sum(w.runtime, delta)
    const tools = sum(w.tools, delta)
    const bytes = slide(meter, w.key, now, own.sent)
    record(meter, w, now, { own, tools, bytes })
    if (bytes < meter.limit) continue
    const last = meter.alerted.get(w.key)
    if (last !== undefined && now - last < COOLDOWN_MS) continue
    meter.alerted.set(w.key, now)
    alerts.push({ key: w.key, label: w.label, threads: w.threads, leader: w.leader, runtime: w.runtime, bytes })
  }
  return alerts
}

/** 设置页要的那份账，最近还在动的排在前面。 */
export function recordsOf(meter: EgressMeter): EgressRecord[] {
  return [...meter.records.values()].sort((a, b) => b.last - a.last)
}

/**
 * 每个 pid 这一拍比上一拍多发了多少。**上一拍还没有外部流量的 pid 整份都算**：它的每一个字节
 * 都是这两拍之间发的，起来就往外发的那一大包正是要抓的。计数变小（pid 被复用）就当从零起。
 */
function deltasOf(meter: EgressMeter, traffic: ReadonlyMap<number, Traffic>, living: ReadonlySet<number>): Map<number, Traffic> {
  const delta = new Map<number, Traffic>()
  for (const [pid, now] of traffic) {
    const before = meter.seen.get(pid)
    meter.seen.set(pid, now)
    if (!meter.primed) continue
    const base = before === undefined || now.sent < before.sent ? { sent: 0, received: 0 } : before
    delta.set(pid, { sent: now.sent - base.sent, received: Math.max(0, now.received - base.received) })
  }
  for (const pid of meter.seen.keys()) if (!living.has(pid)) meter.seen.delete(pid)
  meter.primed = true
  return delta
}

function sum(pids: readonly number[], delta: ReadonlyMap<number, Traffic>): Traffic {
  let sent = 0
  let received = 0
  for (const pid of pids) {
    sent += delta.get(pid)?.sent ?? 0
    received += delta.get(pid)?.received ?? 0
  }
  return { sent, received }
}

/** 把这一拍的量塞进这个进程的一分钟滑窗，返回窗里的总量。 */
function slide(meter: EgressMeter, key: string, now: number, bytes: number): number {
  const window = (meter.windows.get(key) ?? []).filter((entry) => now - entry.at < WINDOW_MS)
  if (bytes > 0) window.push({ at: now, bytes })
  meter.windows.set(key, window)
  return window.reduce((total, entry) => total + entry.bytes, 0)
}

function record(meter: EgressMeter, w: Watched, now: number, got: { own: Traffic; tools: Traffic; bytes: number }): void {
  const prev = meter.records.get(w.key) ?? { sent: 0, received: 0, toolSent: 0, peak: 0, since: now, last: now }
  meter.records.set(w.key, {
    key: w.key,
    label: w.label,
    leader: w.leader,
    threads: w.threads,
    sent: prev.sent + got.own.sent,
    received: prev.received + got.own.received,
    toolSent: prev.toolSent + got.tools.sent,
    peak: Math.max(prev.peak, got.bytes),
    since: prev.since,
    last: got.own.sent + got.tools.sent > 0 ? now : prev.last,
  })
}
