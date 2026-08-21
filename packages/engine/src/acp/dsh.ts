import type { ChildProcess } from "node:child_process"
import type { EngineDriver } from "../contract.js"
import { probeCommand, type Probe } from "../probe.js"
import { createRpc, type RpcPeer } from "../rpc.js"
import { createProcessOwner } from "../subprocess.js"
import { createAcpDriver } from "./driver.js"

/** DSH 把 ACP 做成 profile；omni 只启动这扇公开的 stdio 门。 */
const ACP_ARGS = ["--profile", "acp"] as const
const CHECK_MS = 10_000
const RECLAIM_MS = 500
const STDERR_KEEP = 1200
const INITIALIZE = {
  protocolVersion: 1,
  clientCapabilities: {
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
  },
  clientInfo: { name: "omni", title: "omni 同文", version: "0.1.0" },
}

export type DshCommandProbe = (command: string, hint?: string) => Promise<Probe>
export interface DshProfileStatus {
  ready: boolean
  detail?: string
}
export type DshProfileCheck = (command: string) => Promise<DshProfileStatus>

export interface DshDriverOptions {
  command?: string
  commandProbe?: DshCommandProbe
  profileCheck?: DshProfileCheck
}

function compatible(result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false
  const version = (result as { protocolVersion?: unknown }).protocolVersion
  return version === undefined || (typeof version === "number" && version <= 1)
}

type CheckOutcome = "ready" | "incompatible" | "timeout" | Error

function statusOf(outcome: CheckOutcome, stderr: string): DshProfileStatus {
  if (outcome === "ready") return { ready: true }
  const fallback =
    outcome === "timeout"
      ? `DSH 在 ${String(CHECK_MS / 1000)} 秒内没有完成 ACP initialize。`
      : outcome === "incompatible"
        ? "DSH 返回了 omni 不支持的 ACP initialize 结果。"
        : outcome.message
  return { ready: false, detail: stderr.trim() || fallback }
}

function wire(child: ChildProcess, rpc: RpcPeer, output: { stderr: string }): void {
  child.stdin?.on("error", () => undefined)
  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => rpc.feed(chunk))
  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk: string) => {
    output.stderr = `${output.stderr}${chunk}`.slice(-STDERR_KEEP)
  })
}

/** 真起公开 profile 并做 initialize；只读配置会漏掉插件依赖不兼容。 */
const checkProfile: DshProfileCheck = async (command) => {
  const owner = createProcessOwner({
    exitGraceMs: RECLAIM_MS,
    termGraceMs: RECLAIM_MS,
    killGraceMs: RECLAIM_MS,
  })
  const state: { child: ChildProcess | undefined } = { child: undefined }
  const output: { stderr: string } = { stderr: "" }
  let timer: NodeJS.Timeout | undefined
  const rpc = createRpc({
    send: (line) => state.child?.stdin?.write(`${line}\n`),
    onNotification: () => undefined,
    onRequest: (call) => call.respond({}),
  })
  try {
    state.child = owner.spawn({ command, args: ACP_ARGS, env: process.env })
    wire(state.child, rpc, output)
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), CHECK_MS)
    })
    const outcome: CheckOutcome = await Promise.race([
      rpc.call("initialize", INITIALIZE).then(
        (result) => (compatible(result) ? ("ready" as const) : ("incompatible" as const)),
        (error: Error) => error,
      ),
      owner.died(),
      timeout,
    ])
    return statusOf(outcome, output.stderr)
  } catch (error) {
    return { ready: false, detail: error instanceof Error ? error.message : String(error) }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    state.child?.stdin?.end()
    rpc.close("DSH profile 探测结束")
    await owner.reclaim().catch(() => undefined)
  }
}

export async function probeDshAcp(
  command = "dsh",
  commandProbe: DshCommandProbe = probeCommand,
  profileCheck: DshProfileCheck = checkProfile,
): Promise<Probe> {
  const found = await commandProbe(command, "请先安装 DSH，并配置名为 `acp` 的 ACP profile。")
  if (found.state !== "ok" || found.path === undefined) return found
  const profile = await profileCheck(found.path)
  if (profile.ready) {
    return { ...found, detail: `${found.detail} · ACP profile 可握手` }
  }
  return {
    state: "missing",
    detail: [
      "DSH 已安装，但 `acp` profile 还不能启动。请添加兼容的 ACP profile；也可运行 `dsh --profile acp` 查看原始错误（成功时会等待 ACP 输入，按 Ctrl-C 退出）。",
      profile.detail,
    ]
      .filter(Boolean)
      .join("\n"),
  }
}

/** DSH 的协议仍由通用 ACP 驱动承担；这里只认领公开启动命令与 ACP 握手，不猜凭证状态。 */
export function createDshDriver(options: DshDriverOptions = {}): EngineDriver {
  const command = options.command ?? "dsh"
  const driver = createAcpDriver({ id: "dsh", command, args: ACP_ARGS })
  return {
    ...driver,
    probe: () =>
      probeDshAcp(
        command,
        options.commandProbe ?? probeCommand,
        options.profileCheck ?? checkProfile,
      ),
  }
}
