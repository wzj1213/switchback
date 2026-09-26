import type { ChildProcess } from "node:child_process"
import type { ReclaimConfig } from "../subprocess.js"
import { createProcessOwner, type ProcessOwner } from "../subprocess.js"
import { resolveCommand } from "../probe.js"
import { createKimiApi, type KimiApi, type KimiFetch } from "./http.js"
import type { KimiMeta } from "./wire.js"

export interface KimiDriverConfig {
  command?: string
  webArgs?: readonly string[]
  env?: Readonly<Record<string, string>>
  startupMs?: number
  reclaim?: Partial<ReclaimConfig>
}

export interface KimiEndpoint {
  baseUrl: string
  wsUrl: string
  protocol: string
}

export interface KimiLease extends KimiEndpoint {
  api: KimiApi
  onCrash: (listener: (detail: string) => void) => () => void
  release: () => Promise<void>
  /** 共用的那个 `kimi web` 进程的 pid。几条会话报同一个。 */
  pid: () => number | undefined
}

interface ServerState extends KimiEndpoint {
  api: KimiApi
  child: ChildProcess
  owner: ProcessOwner
  refs: number
  stderr: string
  intentional: boolean
  dead: boolean
  listeners: Set<(detail: string) => void>
}

const DEFAULT_ARGS = ["web", "--no-open", "--port", "0", "--log-level", "silent"] as const
const STARTUP_MS = 20_000
const STDERR_KEEP = 3000

function loopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1"
}

/** 只接受 Kimi 自己打印的 loopback URL；绝不把 bearer token 发去网络地址。 */
export function parseServerOutput(output: string): (KimiEndpoint & { token: string }) | undefined {
  const raw = output.match(/https?:\/\/[^\s]+#token=[A-Za-z0-9_-]+/)?.[0]
  if (raw === undefined) return undefined
  try {
    const url = new URL(raw)
    const token = new URLSearchParams(url.hash.slice(1)).get("token") ?? ""
    if (!loopback(url.hostname) || token === "") return undefined
    const protocol = `kimi-code.bearer.${token}`
    const baseUrl = `${url.protocol}//${url.host}/api/v1`
    const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:"
    return { baseUrl, wsUrl: `${wsProtocol}//${url.host}/api/v1/ws`, protocol, token }
  } catch {
    return undefined
  }
}

function discover(child: ChildProcess, owner: ProcessOwner, budget: number): Promise<KimiEndpoint & { token: string }> {
  const state = { buffer: "", settled: false }
  return new Promise((resolve, reject) => {
    const finish = (error: Error | undefined, endpoint?: KimiEndpoint & { token: string }): void => {
      if (state.settled) return
      state.settled = true
      clearTimeout(timer)
      child.stdout?.off("data", onData)
      if (endpoint !== undefined) resolve(endpoint)
      else reject(error ?? new Error("Kimi Web 服务没有报告地址"))
    }
    const onData = (chunk: string): void => {
      state.buffer = (state.buffer + chunk).slice(-8192)
      const endpoint = parseServerOutput(state.buffer)
      if (endpoint !== undefined) finish(undefined, endpoint)
    }
    const timer = setTimeout(() => finish(new Error(`Kimi Web 服务在 ${String(budget / 1000)} 秒内没有就绪`)), budget)
    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", onData)
    void owner.died().then((error) => finish(error))
  })
}

function validate(meta: KimiMeta): void {
  if (meta.capabilities.websocket !== true) throw new Error("这个 Kimi 版本没有公开 WebSocket 能力，请升级 Kimi Code")
  if (meta.dangerous_bypass_auth === true) {
    throw new Error("Kimi Web 服务关闭了鉴权；omni 拒绝连接这个不安全的实例")
  }
}

export class KimiServerPool {
  private state: ServerState | undefined
  private opening: Promise<ServerState> | undefined
  private closing: Promise<void> | undefined

  constructor(
    private readonly config: KimiDriverConfig = {},
    private readonly fetcher: KimiFetch = fetch,
  ) {}

  private async launch(): Promise<ServerState> {
    const owner = createProcessOwner(this.config.reclaim)
    const command = await resolveCommand(this.config.command ?? "kimi")
    const child = owner.spawn({
      command,
      args: this.config.webArgs ?? DEFAULT_ARGS,
      env: { ...process.env, ...(this.config.env ?? {}) },
    })
    const stderr = { value: "" }
    child.stderr?.setEncoding("utf8")
    child.stderr?.on("data", (chunk: string) => {
      stderr.value = (stderr.value + chunk).slice(-STDERR_KEEP)
    })
    try {
      const discovered = await discover(child, owner, this.config.startupMs ?? STARTUP_MS)
      const { token, ...endpoint } = discovered
      const api = createKimiApi(endpoint.baseUrl, token, this.fetcher)
      validate(await api.get<KimiMeta>("meta"))
      const state: ServerState = {
        ...endpoint,
        api,
        child,
        owner,
        refs: 0,
        stderr: stderr.value,
        intentional: false,
        dead: false,
        listeners: new Set(),
      }
      child.stderr?.on("data", () => {
        state.stderr = stderr.value
      })
      child.on("exit", (code) => this.crashed(state, code))
      return state
    } catch (error) {
      await owner.reclaim().catch(() => undefined)
      const tail = stderr.value === "" ? "" : `\n${stderr.value}`
      throw new Error(`${error instanceof Error ? error.message : String(error)}${tail}`, { cause: error })
    }
  }

  private crashed(state: ServerState, code: number | null): void {
    state.dead = true
    if (this.state === state) this.state = undefined
    if (state.intentional) return
    const tail = state.stderr === "" ? "" : `\n${state.stderr}`
    const detail = `Kimi Web 服务已退出（code ${String(code)}）${tail}`
    for (const listener of state.listeners) listener(detail)
  }

  private async ready(): Promise<ServerState> {
    if (this.closing !== undefined) await this.closing
    if (this.state !== undefined && !this.state.dead) return this.state
    this.opening ??= this.launch().finally(() => {
      this.opening = undefined
    })
    const state = await this.opening
    this.state = state
    return state
  }

  async acquire(): Promise<KimiLease> {
    const state = await this.ready()
    state.refs += 1
    const released = { value: false }
    return {
      baseUrl: state.baseUrl,
      wsUrl: state.wsUrl,
      protocol: state.protocol,
      api: state.api,
      onCrash: (listener) => {
        state.listeners.add(listener)
        return () => state.listeners.delete(listener)
      },
      release: async () => {
        if (released.value) return
        released.value = true
        await this.release(state)
      },
      pid: () => state.owner.pid(),
    }
  }

  private async release(state: ServerState): Promise<void> {
    state.refs = Math.max(0, state.refs - 1)
    if (state.refs > 0 || state.dead || this.state !== state) return
    state.intentional = true
    this.closing = this.stop(state).finally(() => {
      if (this.state === state) this.state = undefined
      this.closing = undefined
    })
    await this.closing
  }

  private async stop(state: ServerState): Promise<void> {
    await state.api.post<{ ok: true }>("shutdown").catch(() => undefined)
    state.child.stdin?.end()
    const report = await state.owner.reclaim()
    if (report.rung === "escaped") {
      throw new Error(`Kimi Web 进程组未能回收（pid ${String(report.pid)}），可能已泄漏`)
    }
  }
}
