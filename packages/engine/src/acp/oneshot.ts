import type { ChildProcess } from "node:child_process"
import { createProcessOwner } from "../subprocess.js"
import { resolveCommand } from "../probe.js"
import { createRpc, type RpcPeer } from "../rpc.js"
import { CLIENT_AUTH } from "./auth.js"
import type { AcpInitialize } from "./wire.js"

/**
 * 起一个 ACP 进程、握一次手、办完一件事就收掉。
 *
 * 试接（`try.ts`）、登录与退出登录（`login.ts`）都是这个形状：**不开会话**，
 * 只和一个陌生程序隔着 stdio 说几句话。三处各写一遍 spawn / 接线 / 回收的话，
 * 「握手失败也要回收进程」这条就得修三次——`driver.ts` 的 `start` 已经为它漏过进程。
 */
export interface OneShotRequest {
  command: string
  args?: readonly string[]
  env?: Readonly<Record<string, string | undefined>>
  cwd: string
}

export interface OneShot {
  rpc: RpcPeer
  /** 进程死了就 resolve（带死因）。和 `call()` 赛跑，起不来毫秒级就知道。 */
  died: Promise<Error>
  /** 它自己打到 stderr 的尾巴。失败时常常是唯一的线索。 */
  stderr: () => string
}

export type Initialized =
  | { kind: "ok"; info: AcpInitialize }
  | { kind: "timeout" }
  | { kind: "died"; error: Error }
  | { kind: "aborted" }

export const PROTOCOL_VERSION = 1
const CLIENT_INFO = { name: "switchback", title: "Switchback", version: "0.1.0" }
const STDERR_KEEP = 4000

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function withAcpProcess<T>(req: OneShotRequest, run: (shot: OneShot) => Promise<T>): Promise<T> {
  const owner = createProcessOwner()
  const box: { child?: ChildProcess; stderr: string } = { stderr: "" }
  const rpc = createRpc({
    send: (line) => box.child?.stdin?.write(`${line}\n`),
    onNotification: () => undefined,
    // 这里没有会话可以答。**必须回错误而不是不理**：不答它会一直等，
    // 而登录那一步本来就可能等上几分钟——两边互等就是一个永远不结束的登录
    onRequest: (call) => {
      call.reject({ code: -32601, message: "Switchback 此时没有打开会话，不处理这类请求" })
    },
  })
  // **spawn 真正能跑的那个绝对路径**，理由同 `resolveCommand`：裸名字会被 PATH
  // 再解析一次，而那次可能落到另一个同名文件上——试接说好、真跑的是另一个
  const child = owner.spawn({
    command: await resolveCommand(req.command),
    args: req.args ?? [],
    cwd: req.cwd,
    ...(req.env === undefined ? {} : { env: { ...process.env, ...req.env } }),
  })
  box.child = child
  child.stdout?.setEncoding("utf8")
  child.stdout?.on("data", (chunk: string) => rpc.feed(chunk))
  child.stderr?.setEncoding("utf8")
  child.stderr?.on("data", (chunk: string) => {
    box.stderr = (box.stderr + chunk).slice(-STDERR_KEEP)
  })
  try {
    return await run({ rpc, died: owner.died(), stderr: () => box.stderr })
  } finally {
    rpc.close("办完了")
    child.stdin?.end()
    await owner.reclaim()
  }
}

/** 人点了「取消」。没给信号就永远不来——在赛跑里只是不参赛。 */
export function abortedBy(signal: AbortSignal | undefined): Promise<"aborted"> {
  return new Promise((resolve) => {
    if (signal === undefined) return
    if (signal.aborted) resolve("aborted")
    else signal.addEventListener("abort", () => resolve("aborted"), { once: true })
  })
}

/**
 * 发一次 `initialize`，和进程死亡、超时、人喊停四方赛跑。
 *
 * 声明 terminal 型登录（`CLIENT_AUTH`）：不声明的话有的 agent 一种登录方式都不报，
 * 试接页上就看不到「这家怎么登录」。
 */
export async function initializeOnce(shot: OneShot, budget: number, signal?: AbortSignal): Promise<Initialized> {
  const result = await Promise.race([
    shot.rpc.call("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, ...CLIENT_AUTH },
      clientInfo: CLIENT_INFO,
    }),
    shot.died.then((error) => ({ died: error })),
    sleep(budget).then(() => "timeout" as const),
    // npx / uvx 第一次要现下载，试接能等上三分钟：人得能在中途喊停
    abortedBy(signal),
  ])
  if (result === "aborted") return { kind: "aborted" }
  if (result === "timeout") return { kind: "timeout" }
  if (typeof result === "object" && result !== null && "died" in result) {
    return { kind: "died", error: (result as { died: Error }).died }
  }
  return { kind: "ok", info: (result ?? {}) as AcpInitialize }
}
