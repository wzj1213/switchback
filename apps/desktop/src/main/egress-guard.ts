import { execFile } from "node:child_process"
import { promises as dns } from "node:dns"
import { promisify } from "node:util"
import type { EngineId, Event } from "@switchback/protocol"
import type { EngineProcess } from "@switchback/host"
import { tree } from "@switchback/engine"
import type { Logger } from "./log.js"
import { createEgressMeter, observe, recordsOf, type EgressAlert, type EgressMeter, type EgressRecord, type Watched } from "./egress-meter.js"
import { parseLsofPeers, parseNettop, parsePs, treeOf, zcodeMains, type Proc } from "./egress-sample.js"

/**
 * 外发守卫：盯着每个引擎进程（和单独开着的 ZCode）往本机外面发了多少，**批量往外发就停掉它**。
 *
 * ## 为什么要有
 *
 * 2026-09 ZCode 被扒出来：登录着就在后台把整个工作区——连同完整的 `.git` 历史、LFS 缓存、
 * reflog——打包加密传到阿里云 OSS，设置里那两个开关管不住它。Switchback 起的每一家引擎都跑在你的
 * 仓库里，**哪一家这么干，Switchback 都该第一时间看见、并且拦得住**，而不是等别人去逆向。
 *
 * ## 边界
 *
 * 只看、只停：不改引擎的配置、不给它注入环境变量、不挡它的请求。看的是系统自己记的账
 *（`nettop` 的每进程外部流量），判的是它**自己**一分钟发了多少（见 `egress-meter.ts`）。
 * 停不停由设置里那个开关决定，默认停。
 *
 * macOS 专属：`nettop` 只有 macOS 有。别的平台这一层整个不起。
 */

const run = promisify(execFile)
const MB = 1024 * 1024

/** 有东西可盯时多久看一次。 */
const BUSY_MS = 3000
/** 没东西可盯（没会话在跑、也没开着 ZCode）时多久看一次：只为了发现 ZCode 被打开。 */
const IDLE_MS = 15_000
/** 停掉之后等多久还不退就强杀。 */
const KILL_AFTER_MS = 3000

export interface EgressDeps {
  /** 每条活会话背后的引擎进程（`Host.processes`）。 */
  processes: () => readonly EngineProcess[]
  emit: (event: Event) => void
  log: Logger
  /** 批量外发时停不停掉它（设置里那个开关）。 */
  stop: () => boolean
  /** 引擎 id → 给人看的名字。 */
  label: (engine: EngineId) => string
}

export interface EgressGuard {
  /** 这次启动以来每个进程树的外发账。设置页「外发记录」读它。 */
  records: () => readonly EgressRecord[]
  dispose: () => void
}

/**
 * 开发时演一遍用的两个旋钮：`SWITCHBACK_DEV_EGRESS_IFACE=loopback` 只数本机回环（假引擎往本机的
 * 一个口子里「上传」，一个字节都不出这台机器），`SWITCHBACK_DEV_EGRESS_LIMIT_MB` 把线调低。
 * 不设就是正式的样子：只数离开这台机器的流量，线是 64 MB。
 */
function devKnobs(): { iface: "external" | "loopback"; limit: number | undefined } {
  const mb = Number(process.env["SWITCHBACK_DEV_EGRESS_LIMIT_MB"])
  return {
    iface: process.env["SWITCHBACK_DEV_EGRESS_IFACE"] === "loopback" ? "loopback" : "external",
    limit: Number.isFinite(mb) && mb > 0 ? mb * MB : undefined,
  }
}

export function watchEgress(deps: EgressDeps): EgressGuard {
  if (process.platform !== "darwin") return { records: () => [], dispose: () => undefined }
  const knobs = devKnobs()
  const meter = createEgressMeter(knobs.limit)
  const state: { timer: NodeJS.Timeout | undefined; disposed: boolean } = { timer: undefined, disposed: false }
  const tick = async (): Promise<void> => {
    const next = await once(deps, meter, knobs.iface).catch((error: unknown) => {
      deps.log.write("warn", "egress", `这一拍没看成：${String(error)}`)
      return IDLE_MS
    })
    if (!state.disposed) state.timer = setTimeout(() => void tick(), next)
  }
  state.timer = setTimeout(() => void tick(), BUSY_MS)
  return {
    records: () => recordsOf(meter),
    dispose: () => {
      state.disposed = true
      clearTimeout(state.timer)
    },
  }
}

/** 看一拍，返回下一拍隔多久。 */
async function once(deps: EgressDeps, meter: EgressMeter, iface: "external" | "loopback"): Promise<number> {
  const procs = parsePs((await run("ps", ["-A", "-o", "pid=,ppid=,pgid=,command="], { maxBuffer: 32 * MB })).stdout)
  const watched = watchedOf(procs, deps)
  if (watched.length === 0) return IDLE_MS
  const out = await run("nettop", ["-P", "-L", "1", "-x", "-t", iface, "-J", "bytes_in,bytes_out"], { maxBuffer: 32 * MB })
  const living = new Set(procs.map((p) => p.pid))
  const alerts = observe(meter, Date.now(), { watched, traffic: parseNettop(out.stdout), living })
  for (const alert of alerts) await respond(deps, alert)
  return BUSY_MS
}

/** 这一拍要盯的进程树：每个引擎进程一棵（几条会话共用的合成一棵），再加单独开着的 ZCode。 */
function watchedOf(procs: readonly Proc[], deps: EgressDeps): Watched[] {
  const byPid = new Map<number, { engine: EngineId; threads: string[] }>()
  for (const p of deps.processes()) {
    const entry = byPid.get(p.pid) ?? { engine: p.engine, threads: [] }
    entry.threads.push(p.threadId)
    byPid.set(p.pid, entry)
  }
  const engines = [...byPid].map(([pid, e]) => ({ key: `pid:${String(pid)}`, label: deps.label(e.engine), threads: e.threads, ...treeOf(procs, pid) }))
  const apps = zcodeMains(procs).map((pid) => ({ key: `zcode:${String(pid)}`, label: "ZCode", threads: [], ...treeOf(procs, pid) }))
  return [...engines, ...apps]
}

async function respond(deps: EgressDeps, alert: EgressAlert): Promise<void> {
  const peers = await peersOf(alert.runtime)
  const stopped = deps.stop() && halt(alert.leader)
  const mb = String(Math.round(alert.bytes / MB))
  deps.log.write(
    "warn",
    "egress",
    `${alert.label}（pid ${String(alert.leader)}）一分钟内自己往外发了 ${mb} MB${stopped ? "，已停掉" : ""}；对端：${peers.join("、") || "没抓到"}`,
  )
  deps.emit({ type: "egress.alert", at: Date.now(), threadId: alert.threads[0] ?? "", detail: detailOf(alert, mb, peers, stopped), stopped })
}

/**
 * 停掉它：先 SIGTERM 整个进程组，三秒还在就强杀。
 * 引擎是 `detached` 起的组长，工具进程都在组里；单独开着的 ZCode 不一定是组长，那就直接发给它本身。
 */
function halt(pid: number): boolean {
  tree.term(pid)
  try {
    process.kill(pid, "SIGTERM")
  } catch {
    // 已经随进程组一起没了
  }
  setTimeout(() => {
    if (tree.alive(pid)) tree.kill(pid)
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // 已经退了
    }
  }, KILL_AFTER_MS)
  return true
}

/** 当时它连着谁：对端地址，能反查出主机名的带上主机名。抓不到就是空的，不耽误报警。 */
async function peersOf(pids: readonly number[]): Promise<string[]> {
  if (pids.length === 0) return []
  try {
    const out = await run("lsof", ["-nP", "-a", "-iTCP", "-sTCP:ESTABLISHED", "-p", pids.join(",")], { timeout: 2000, maxBuffer: 4 * MB })
    const peers = parseLsofPeers(out.stdout).slice(0, 4)
    return await Promise.all(peers.map(named))
  } catch {
    return []
  }
}

async function named(peer: string): Promise<string> {
  const ip = peer.replace(/^\[/, "").replace(/\]?:\d+$/, "")
  const host = await Promise.race([
    dns.reverse(ip).then((names) => names[0]).catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(resolve, 800, undefined)),
  ])
  return host === undefined ? peer : `${peer}（${host}）`
}

function detailOf(alert: EgressAlert, mb: string, peers: readonly string[], stopped: boolean): string {
  const app = alert.key.startsWith("zcode:")
  const who = app ? "单独开着的 ZCode" : alert.label
  const where = peers.length === 0 ? "" : `当时它连着：${peers.join("、")}。`
  const why = app
    ? "ZCode 3.14.0 之前的版本会在后台把整个工作区连同 .git 历史打包上传。"
    : "正常对话一次请求通常不到 1 MB，这个量更像是在把整个工作区往外传。"
  const keep = app ? "要停就退出 ZCode。" : "要停就关掉这条会话。"
  const then = stopped
    ? "Switchback 已经停掉了它。确认是你让它传的，可以在「设置 → 数据与排查」里关掉「批量外发时停掉」。"
    : `「批量外发时停掉」关着，Switchback 没有停它；${keep}`
  return `${who} 一分钟内自己往本机外面发了 ${mb} MB（不算它跑的命令）。${why}${where}${then}`
}
