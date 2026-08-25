import type { ChildProcess } from "node:child_process"
import type { EngineStatus, ModelOption, TurnId } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import type { ProcessOwner } from "../subprocess.js"
import { resolveCommand } from "../probe.js"
import type { RpcPeer } from "../rpc.js"
import { reportAccount } from "./account.js"
import { claimedCapabilities } from "./claims.js"
import { forkCodexThread } from "./fork.js"
import type { CodexHistoryThread } from "./history.js"
import { raceStartup } from "./startup-deadline.js"
import type { WireApprovalPolicy, WireApprovalsReviewer, WireSandbox } from "./wire.js"

/**
 * 这条会话**怎么开场**：起进程 → 握手 → 开/续/分一条 codex thread。
 *
 * ## 为什么单独一个文件
 *
 * 和 `acp/open.ts` 同一个边界，两个驱动就该长得一样：驱动本体管的是
 * 「跑起来之后怎么收发」，开场是另一件事——它只跑一次，失败方式也自成一类
 *（起不来、握手超时、续跑的会话没了），而这些失败**每一种都要说出人能照着做的下一句话**。
 *
 * 拆出来的直接理由是行数闸门：`driver.ts` 实测正好 300/300，一行有效代码都加不进去。
 * 但边界本来就在这儿——**以后往 `initialize` 里加能力协商，加的地方是这里，不是驱动**。
 */

/** 会话跑起来之后要一直带着的那点状态。开场负责把它填上。 */
export interface SessionState {
  child: ChildProcess | undefined
  codexThread: string | undefined
  codexTurn: string | undefined
  turn: TurnId | undefined
  stderr: string
  sandbox: WireSandbox
  approval: WireApprovalPolicy
  reviewer: WireApprovalsReviewer
  /** 用户选的模型与强度。`turn/start` 时带上，codex 说它对后续轮次也生效。 */
  model: string | undefined
  effort: string | undefined
  /** `thread/resume` 已公开返回的完整 turns；接管时由 transcript 消费一次。 */
  openedThread: CodexHistoryThread | undefined
  /**
   * 上次问到的模型清单。**留着是为了补强度**——见 `setModel`。
   * 只在 `models()` 被调用时更新，拿不到就是空的，那时不补。
   */
  options: readonly ModelOption[]
}

export interface OpenCtx {
  rpc: RpcPeer
  owner: ProcessOwner
  /**
   * 只声明开场用得到的那两项。**不直接引 `CodexDriverConfig`**——
   * 那会绕成 driver → open → driver 的循环 import（`acp/open.ts` 同样的取舍）。
   */
  config: { command?: string; args?: readonly string[] }
  req: StartRequest
  state: SessionState
  status: (status: EngineStatus, detail?: string) => void
  /**
   * 把子进程的 stdout/stderr/exit 接到 rpc 与状态上。
   *
   * 留在驱动里、由这里回调：它连着「一轮怎么落终态」（`endTurn`），
   * 那是驱动的事，不是开场的事。
   */
  wire: (child: ChildProcess) => void
}

const CLIENT_INFO = { name: "omni", title: "omni 同文", version: "0.1.0" }

/** 握手上限。超过这个还没回 `initialize`，就当它起不来了。 */
const HANDSHAKE_MS = 20_000
/** initialize 已回、开原生 thread 还没回，也不能让界面永远停在 starting。 */
const OPEN_THREAD_MS = 20_000

/**
 * 把起进程的失败翻成人能照着做的一句话。
 *
 * `Error: spawn codex ENOENT` 对用户毫无意义——他要知道的是「装了没」「装哪了」。
 * 这是生产可用与否的分界线之一：报错必须说得出下一步该干什么。
 */
function startupMessage(command: string, error: Error): string {
  const code = (error as NodeJS.ErrnoException).code
  if (code === "ENOENT") {
    return `找不到可执行文件 \`${command}\`。请确认已安装 codex CLI，且它在 PATH 上（终端里跑 \`which codex\` 验证）。`
  }
  if (code === "EACCES") return `没有权限执行 \`${command}\`。`
  return `启动 \`${command}\` 失败：${error.message}`
}

export async function openSession(ctx: OpenCtx): Promise<void> {
  ctx.status("starting")
  // 继承父环境：codex 的登录态、PATH、代理设置全在里面。
  // 凭据擦洗是 EngineDescriptor 描述的以后的事，现在擦了就登录不上。
  // **spawn 真正能跑的那个绝对路径，不是裸名字**：裸名字由 PATH 再解析一次，
  // 而那次可能落到另一个同名文件上（真机上遇到过一个不存在的空壳排在前面）——
  // 那样「探测说好、真跑的是另一个」，是最难查的一类故障。见 `resolveCommand`
  const child = ctx.owner.spawn({
    command: await resolveCommand(ctx.config.command ?? "codex"),
    args: ctx.config.args ?? ["app-server", "--stdio"],
    cwd: ctx.req.cwd,
    env: process.env,
  })
  ctx.state.child = child
  ctx.wire(child)

  await handshake(ctx)
  const started = await openingThread(ctx)
  const thread = (started as { thread?: CodexHistoryThread } | undefined)?.thread
  const id = thread?.id
  if (id === undefined) throw new Error("codex 没有返回 thread id，无法继续")
  ctx.state.openedThread = thread
  ctx.state.codexThread = id
  // codex 的 thread id 就是它的会话句柄——落盘之后下次能凭它续跑
  ctx.req.onHandle?.(id)
  ctx.status("ready")
}

/**
 * 开会话。带句柄就续跑，不带就新开。
 *
 * 续跑失败（历史被清、版本不兼容）**不能静默降级成新会话**——那样用户会以为
 * 上下文还在，实际模型什么都不记得。宁可把失败摆出来。
 */
function openThread(ctx: OpenCtx): Promise<unknown> {
  // 策略和沙箱一样按 app-server 进程固定；改档时宿主会续接同一 thread 重启进程
  const shared = {
    approvalPolicy: ctx.state.approval,
    approvalsReviewer: ctx.state.reviewer,
    sandbox: ctx.state.sandbox,
    cwd: ctx.req.cwd,
  }
  if (ctx.req.forkOf !== undefined) {
    return forkCodexThread((method, params) => ctx.rpc.call(method, params), ctx.req.forkOf)
  }
  if (ctx.req.resume === undefined) return ctx.rpc.call("thread/start", shared)
  return ctx.rpc.call("thread/resume", { threadId: ctx.req.resume, ...shared })
}

function openingLabel(ctx: OpenCtx): string {
  if (ctx.req.forkOf !== undefined) return "分叉会话（thread/fork）"
  if (ctx.req.resume !== undefined) return "续接会话（thread/resume）"
  return "新建会话（thread/start）"
}

function stderrTail(ctx: OpenCtx): string {
  return ctx.state.stderr === "" ? "" : `\n${ctx.state.stderr}`
}

/** 第二段开场也要有和握手同样的退出、超时护栏。 */
async function openingThread(ctx: OpenCtx): Promise<unknown> {
  const command = ctx.config.command ?? "codex"
  const result = await raceStartup(openThread(ctx), ctx.owner.died(), OPEN_THREAD_MS)
  if (result.kind === "ready") return result.value
  if (result.kind === "died") throw new Error(startupMessage(command, result.error))
  throw new Error(
    `codex 在 ${String(OPEN_THREAD_MS / 1000)} 秒内没有完成${openingLabel(ctx)}，已停止并回收进程。${stderrTail(ctx)}`,
  )
}

/**
 * 以分叉开场。`thread/fork` 复制的是**真的会话**——分出来那条记得原会话
 * 读过哪些文件、写过什么、撞过什么错，而不是只拿到一句提炼过的目标。
 *
 * **必须由这个进程自己 fork。** 让原会话那个进程分好再交给这边去 `thread/resume`，
 * 真机上直接失败：`thread ... already has an active writer`——
 * 分出来的那条归创建它的进程管，而 omni 一个会话一个进程。
 * `thread/unsubscribe` 也不放锁（都实测过）。
 *
 * `dropTurns` 先只读源会话的原生 turn id，再把 `lastTurnId` / `beforeTurnId` 直接交给
 * `thread/fork`：原会话与工作树都不动，新分支从出生起就是目标边界。不能再 fork 后调用
 * `thread/revert`——0.149.0 真机明确拒绝 legacy 历史；更不能吞掉失败冒充剪裁成功。
 *
 * 分不出来就抛：宿主要靠这个失败区分原生复制与空白分支；
 * 对“从这里重来”，默默起空会话尤其会制造成功假象。
 */
/**
 * 握手。**必须有超时，也必须看 spawn 本身是否失败**。
 *
 * 起不来的进程不会产出任何 stdout，`rpc.call("initialize")` 于是永远不 resolve，
 * 界面就一直停在「正在打开工作区…」——没有报错、没有超时、什么都没有，
 * 这是最难查的一类故障。
 */
async function handshake(ctx: OpenCtx): Promise<void> {
  const command = ctx.config.command ?? "codex"
  const result = await raceStartup(
    // **认领什么只有一个来源**（`claims.ts`），代码里不另写一份——
    // 写两份的下场是那张表变成一份没人对照的文档
    ctx.rpc
      .call("initialize", { clientInfo: CLIENT_INFO, capabilities: claimedCapabilities() })
      .then(() => undefined),
    ctx.owner.died(),
    HANDSHAKE_MS,
  )
  if (result.kind === "died") throw new Error(startupMessage(command, result.error))
  if (result.kind === "timeout") {
    throw new Error(
      `codex 在 ${String(HANDSHAKE_MS / 1000)} 秒内没有完成握手，已停止并回收进程。${stderrTail(ctx)}`,
    )
  }
  ctx.rpc.notify("initialized")
  // 账号侧的现状（额度、登录）——**在动手之前问**，见 `account.ts`
  reportAccount(
    ctx.rpc,
    (status, detail) => {
      ctx.status(status, detail)
    },
    ctx.req.emit,
  )
}
