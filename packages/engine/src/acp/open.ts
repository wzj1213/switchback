import type { ChildProcess } from "node:child_process"
import type { EngineCapabilities, EngineStatus, ModelOption, Trust } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { localeOf } from "../locale.js"
import type { ProcessOwner } from "../subprocess.js"
import { resolveCommand } from "../probe.js"
import { rpcCodeOf, RpcError, type RpcPeer } from "../rpc.js"
import { AcpAuthRequired, AUTH_REQUIRED, authMethodsOf, authRequiredText, CLIENT_AUTH, type AcpAuthMethod } from "./auth.js"
import {
  canList,
  capabilitiesOf,
  catalogOf,
  contextWindows,
  currentModeOf,
  modesOf,
  startupMessage,
} from "./setup.js"
import type { Catalog } from "./setup.js"
import type { ForeignFork, ForeignSteer } from "./caps.js"
import type { AcpInitialize, AcpNewSession } from "./wire.js"
import { ACP_OPEN } from "./open.messages.js"

/**
 * 一条 ACP 会话**怎么开场**：握手、开新的 / 续上一条 / 分一条出来。
 *
 * 从驱动里拆出来是行数闸门逼的，但边界本来就该有：驱动的日常是收通知、发提示词、
 * 落事件；开场只发生一次，而它恰恰是最容易出错、也最该被单独读一遍的一段
 * （版本不合、能力对不上、句柄接不回来，都在这几十行里）。
 */

const PROTOCOL_VERSION = 1
const CLIENT_INFO = { name: "switchback", title: "Switchback", version: "0.1.0" }
const HANDSHAKE_MS = 20_000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** `session/new` / `session/load` / `session/fork` 共用的那几个参数。 */
interface Shared {
  cwd: string
  mcpServers: never[]
  /** 各家的原生审批开关等等，见 `AcpDriverConfig.nativeApproval`。 */
  _meta?: Readonly<Record<string, unknown>>
}

/** 这家的原生审批开关按当前信任档算出来的东西。见 `AcpDriverConfig.nativeApproval`。 */
export interface Native {
  meta?: Readonly<Record<string, unknown>>
  note?: string
}

/** 开场要改写的那部分状态。驱动把自己的 state 传进来，这里就地填。 */
export interface OpenState {
  acpSession: string | undefined
  modes: readonly { id?: string; name?: string }[]
  /**
   * 引擎此刻在哪一档——**开场时由回包认领，之后由 `current_mode_update` 跟着更新**。
   *
   * ACP 的 mode 是双向的：客户端能设，agent 也能自己切。两条来源都要落到这里，
   * 否则它记的就只是「Switchback 一厢情愿设过什么」。上一版正是那样，而 `applyTrust`
   * 曾拿它做「已经是这一档就不发」的短路——于是 agent 自己切走之后，
   * 用户再切回来是个**空操作**（见 `mode.ts` 里那段注释，短路已经拿掉）。
   *
   * 短路拿掉之后这个字段没有读者了，但它必须继续记真话：档位回读那一批
   *（见 `docs/侧栏与引擎状态方案.md`）要把它和引擎自报的那档并排显示，对不上时如实说。
   */
  mode: string | undefined
  models: readonly ModelOption[]
  loadSession: boolean
  /**
   * agent 支不支持列历史会话（`session/list`）。
   *
   * **三态**：`true` 是它自己声明的；`false` 是问过之后确认不行；
   * `undefined` 是「它没声明，但也没说不行」——那就问一次再说，见 `driver.ts`
   * 的 `history()`。实测 grok 就是这一档：能力表是空的，`session/list` 却能答。
   */
  canList: boolean | undefined
  /** 当前推理强度。有的适配器把它做成会话级选项（kimi 的 `thinking`）。 */
  effort: string | undefined
  /**
   * **换模型往哪儿发**：有值就是 `session/set_config_option` 的 `configId`，
   * `undefined` 就是规范的 `session/set_model`。
   *
   * 「清单从哪儿读的，就设回哪儿」——理由见 `modelCatalogOf`：ZCode 的桥
   * 只实现了前者，拿后者去设会得到一条 `Method not found` 的红色故障。
   */
  modelConfig: string | undefined
  /** 换强度要报的 `configId`。各家名字不一样（kimi `thinking`、ZCode `thought`）。 */
  effortConfig: string | undefined
  /** modelId → 上下文窗口大小。见 `contextWindows`：换模型时分母会变。 */
  windowOf: Readonly<Record<string, number>>
  /** 当前模型的窗口大小。没有就不画比例条——不猜分母。 */
  contextWindow: number | undefined
  /** 握手时 agent 自报的能力。**能力位由它推导，不写死**——见 `capabilitiesOf`。 */
  caps: EngineCapabilities
  /**
   * 开会话时按信任档算出来的原生审批开关。
   *
   * 留着它有两个用处：那句要对用户说的话（`note`），
   * 以及中途换档时判断「开会话时定死的那个值和现在要的还一样吗」。
   */
  native: Native | undefined
  /** 子进程的 stderr 尾巴。握手超时要把它摊出来，不然只有一句「超时了」。 */
  stderr: string
  /**
   * 握手时它报的登录方式。开会话撞上 `-32000` 时要靠它说清「可以怎么登录」——
   * 那一刻手上只有它自己的一句话，而那句话实测不一定提到登录。
   */
  authMethods?: readonly AcpAuthMethod[]
}

/** `startSession` 要的东西：`OpenCtx` 再加三件驱动才知道怎么做的事。 */
export interface StartCtx extends OpenCtx {
  config: OpenCtx["config"] & { args?: readonly string[]; env?: Readonly<Record<string, string>> }
  /** 子进程句柄由开场填上；`OpenState` 不含它，那是驱动 `SessionState` 的字段。 */
  state: OpenState & { child: ChildProcess | undefined }
  status: (status: EngineStatus, detail?: string) => void
  /** 把子进程的 stdout/stderr/exit 接到 rpc 上。留在驱动里，见 `codex/open.ts` 的同名字段。 */
  wire: (child: ChildProcess) => void
  /** 把信任档落到引擎上。它要的 `TrustCtx` 是另一份上下文，所以由驱动包一层递进来。 */
  applyTrust: () => Promise<void>
}

export interface OpenCtx {
  rpc: RpcPeer
  owner: ProcessOwner
  /** 只声明开场用得到的那几项。**不直接引 `AcpDriverConfig`**：那会绕成
      driver → open → driver 的循环 import。 */
  config: {
    id: string
    label?: string
    command: string
    modeReadback?: boolean
    compact?: boolean
    steer?: boolean
    steerCall?: ForeignSteer
    fork?: ForeignFork
    activity?: unknown
    terminal?: boolean
    nativeApproval?: (trust: Trust) => Native
  }
  req: StartRequest
  state: OpenState
}

/**
 * 握手。超时 + 看 spawn 是否失败，两条都要——理由同 codex 驱动：
 * 起不来的进程不产出 stdout，`call()` 于是永远不 resolve，界面就一直停在
 * 「正在打开工作区…」，没有报错也没有超时，是最难查的一类故障。
 */
export async function handshake(ctx: OpenCtx): Promise<EngineCapabilities> {
  const result = await Promise.race([
    ctx.rpc.call("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      // `terminal` **按引擎注入**：kimi 不认领就一条命令都跑不了（它没有本地兜底），
      // 而别家自己起进程，认领了反而把命令从它们的沙箱里拽出来。见 `terminal.ts`
      // 声明能跑 terminal 型登录：不声明的话有的 agent 一种登录方式都不报（见 `auth.ts`）
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: ctx.config.terminal === true,
        ...CLIENT_AUTH,
      },
      clientInfo: CLIENT_INFO,
    }),
    ctx.owner.died().then((error) => ({ died: error })),
    sleep(HANDSHAKE_MS).then(() => "timeout" as const),
  ])
  const m = ACP_OPEN[localeOf(ctx.req)]
  if (result === "timeout") {
    const tail = ctx.state.stderr === "" ? "" : `\n${ctx.state.stderr}`
    throw new Error(`${m.handshake(ctx.config.id, HANDSHAKE_MS / 1000)}${tail}`)
  }
  if (typeof result === "object" && result !== null && "died" in result) {
    throw new Error(startupMessage(ctx.config.command, (result as { died: Error }).died, localeOf(ctx.req)))
  }
  const info = result as AcpInitialize
  const version = info.protocolVersion
  // 版本不合就直接说。协议原文：客户端不支持返回的版本时应当断开
  if (version !== undefined && version > PROTOCOL_VERSION) {
    throw new Error(m.tooNew(ctx.config.id, version, PROTOCOL_VERSION))
  }
  ctx.state.loadSession = info.agentCapabilities?.loadSession === true
  ctx.state.authMethods = authMethodsOf(info)
  // **能力由 agent 自报，不由 Switchback 猜**：同一个驱动接的几家本来就不一样。
  // 但「没声明」只是没声明——实测 grok 的能力表是空的，`session/list` 却能答，
  // 所以这里留 undefined，由 `history()` 问一次再定（见那边的注释）
  ctx.state.canList = canList(info) ? true : undefined
  // **只挑「各家自己说」的那几位往下递**，不是把整份 config 传进去：
  // `capabilitiesOf` 的其余各位都从握手结果推，混在一起会让「哪些能推、哪些得问」
  // 这条界线糊掉——而那条界线正是这个函数存在的理由
  const { modeReadback, compact, steer, steerCall, fork, activity } = ctx.config
  return capabilitiesOf(info, {
    modeReadback,
    compact,
    steer: steer === true || steerCall !== undefined,
    fork: fork !== undefined,
    activity: activity !== undefined,
  })
}

/**
 * 从起进程到能收发的**整条开场序列**：spawn → 接线 → 握手 → 开/续/分会话 → 落信任档。
 *
 * 和 `codex/open.ts` 的 `openSession` 对称。**两个驱动的开场应当长得一样**——
 * 它们失败的方式是同一类（起不来、握手超时、续跑的会话没了），
 * 而每一种都要说出人能照着做的下一句话；分头写两份，迟早只有一份说得清楚。
 */
export async function startSession(ctx: StartCtx): Promise<void> {
  ctx.status("starting")
  // **spawn 真正能跑的那个绝对路径，不是裸名字**：裸名字由 PATH 再解析一次，
  // 而那次可能落到另一个同名文件上（真机上遇到过一个不存在的空壳排在前面）——
  // 那样「探测说好、真跑的是另一个」，是最难查的一类故障。见 `resolveCommand`
  const child = ctx.owner.spawn({
    command: await resolveCommand(ctx.config.command),
    args: ctx.config.args ?? [],
    cwd: ctx.req.cwd,
    env: { ...process.env, ...(ctx.config.env ?? {}) },
  })
  ctx.state.child = child
  ctx.wire(child)
  ctx.state.caps = await handshake(ctx)
  await openSession(ctx)
  // 档位在开会话之后统一施加：`session/new` 才拿得到 agent 报的档位表
  await ctx.applyTrust()
  ctx.status("ready")
}

/**
 * 开会话撞上 `-32000`（要先登录）时，把它那句话翻成**说得出下一步**的一句：
 * 它自己的原话、握手时报过哪几种登录方式、去哪儿登录。别的错误原样抛。
 *
 * 只认错误码，不认措辞：实测 Gemini CLI 在这一码下说的是「这个客户端已不再支持」，
 * 按「Authentication required」字样去匹配就会漏掉它。
 */
function loginFirst(ctx: OpenCtx, error: unknown): unknown {
  if (rpcCodeOf(error) !== AUTH_REQUIRED) return error
  const said = error instanceof RpcError && error.said !== "" ? error.said : "Authentication required"
  const text = authRequiredText(ctx.config.label ?? ctx.config.id, ctx.state.authMethods ?? [], said, localeOf(ctx.req))
  return new AcpAuthRequired(text, ctx.config.id)
}

/**
 * 开会话。带句柄就 `session/load` 续跑。
 *
 * **agent 不支持 `loadSession` 时不能静默新开**——用户会以为上下文还在，
 * 实际模型什么都不记得。宁可把失败摆出来（和 codex 驱动同一条原则）。
 */
export async function openSession(ctx: OpenCtx): Promise<void> {
  await openOrFail(ctx).catch((error: unknown) => {
    throw loginFirst(ctx, error)
  })
}

async function openOrFail(ctx: OpenCtx): Promise<void> {
  // **原生审批开关只在开会话时能设**（grok 的 `autoMode` / `yoloMode` 在 `_meta` 里），
  // 所以它必须在这儿算好，而且续跑/分叉那两条路也要带上——
  // 只给新会话带的话，接着跑的那条会话会悄悄退回引擎自己的默认档
  const native = ctx.config.nativeApproval?.(ctx.req.trust as Trust)
  ctx.state.native = native
  const shared: Shared = {
    cwd: ctx.req.cwd,
    mcpServers: [],
    ...(native?.meta === undefined ? {} : { _meta: native.meta }),
  }
  const m = ACP_OPEN[localeOf(ctx.req)]
  if (ctx.req.forkOf !== undefined) {
    if ((ctx.req.forkOf.dropTurns ?? 0) > 0) throw new Error(m.forkTail(ctx.config.id))
    await forkSession(ctx, ctx.req.forkOf.handle, shared)
    return
  }
  if (ctx.req.resume !== undefined) {
    if (!ctx.state.loadSession) throw new Error(m.noResume(ctx.config.id))
    // **回包要接住。** 上一版把它整个丢了，于是续跑的会话上目录全空：
    // 强度设不上（`effortConfig` 空 → `applyEffort` 静默 return）、
    // **信任档落不到引擎上**（`modes` 空 → `applyTrust` 直接返回）、
    // 上下文比例条不画（分母未知）、模型清单空。
    // 其中「换模型还能用」纯属巧合——清单空时 `modelCall` 退回发规范的
    // `session/set_model`，而那一发恰好几家都实现了。**最显眼的那样被巧合救了，
    // 正是这个洞一直没被发现的原因。**
    const loaded = ((await ctx.rpc.call("session/load", { sessionId: ctx.req.resume, ...shared })) ??
      {}) as AcpNewSession
    ctx.state.acpSession = ctx.req.resume
    ctx.req.onHandle?.(ctx.req.resume)
    // 只认领目录，**不碰 sessionId**——`session/load` 的回包里没有它，见 `adoptCatalogue`
    adoptCatalogue(ctx, loaded)
    return
  }
  const created = (await ctx.rpc.call("session/new", shared)) as AcpNewSession
  adopt(ctx, created)
  }

/**
 * 以分叉开场。`session/fork` 复制的是**真的会话**——分出来那条记得原会话
 * 聊过什么，而不是只拿到一句提炼过的目标。
 *
 * 和 codex 那边同一个道理：**必须由这个进程自己 fork**，
 * 所以它属于「这条会话怎么开场」（`StartRequest.forkOf`），
 * 不是老会话上的一个方法。
 *
 * ACP 没有「只保留前 N 轮」的入口。能力表因此只报 `fork`、不报 `rewind`；
 * 这里仍做一次防御性拒绝，避免旧宿主或手写请求把完整历史冒充成回退。
 */
async function forkSession(ctx: OpenCtx, handle: string, shared: Shared): Promise<void> {
  if (ctx.config.fork !== undefined) {
    await forkForeign(ctx, ctx.config.fork, handle, shared)
    return
  }
  const forked = (await ctx.rpc.call("session/fork", { sessionId: handle, ...shared })) as AcpNewSession
  adopt(ctx, forked)
}

/** 厂商扩展只负责复制；新进程再用标准 load 接住，避免 fork 出来却仍连着父会话。 */
async function forkForeign(ctx: OpenCtx, adapter: ForeignFork, handle: string, shared: Shared): Promise<void> {
  const m = ACP_OPEN[localeOf(ctx.req)]
  if (!ctx.state.loadSession) throw new Error(m.forkNeedsLoad(ctx.config.id))
  const request = adapter.request(handle, shared.cwd)
  const raw = await ctx.rpc.call(request.method, request.params)
  const forked = adapter.handle(raw)
  if (forked === undefined) throw new Error(m.forkNoHandle(ctx.config.id))
  const loaded = ((await ctx.rpc.call("session/load", { sessionId: forked, ...shared })) ?? {}) as AcpNewSession
  ctx.state.acpSession = forked
  ctx.req.onHandle?.(forked)
  adoptCatalogue(ctx, loaded)
}

/**
 * 把一份清单落到状态上。
 *
 * **开场时和 agent 中途自己改配置时走的是同一步**（见 `update.ts` 的
 * `config_option_update`）。写两遍的下场是其中一遍漏掉一样——
 * 而漏掉不报错，只会让界面上摆着一个引擎已经不认的选项。
 */
export function adoptCatalog(state: OpenState, catalog: Catalog): void {
  state.models = catalog.models
  state.modelConfig = catalog.modelConfig
  state.effortConfig = catalog.effortConfig
  state.effort = catalog.effort
}

/**
 * 认领回包里的**目录**那一半：模型、强度、档位、窗口。**不碰 sessionId。**
 *
 * ## 为什么必须和 `adopt()` 分开，而不是让续跑复用它
 *
 * 因为 `session/load` 的回包里**就是没有 sessionId**。实测 grok（`grok agent stdio`）：
 *
 * ```
 * session/new  → { sessionId, models, _meta }
 * session/load → {            models, _meta }      ← 形状一样，只少这一个字段
 * ```
 *
 * 而 `adopt()` 开头那句是「没有返回 sessionId 就抛」。让续跑复用它，等于把今天这个
 * **静默降级**换成**续跑当场抛错**——后者更坏。续跑路径上的 id 本来也不需要从回包里取，
 * 它就是调用方传进来的 `req.resume`。
 *
 * 分出来之后，三条开场路径（新建 / 分叉 / 续跑）**认领的目录是同一份逻辑**，
 * 这正是上一版漏掉续跑那条的原因：目录认领本来就藏在 `adopt()` 里，
 * 而续跑不调 `adopt()`。
 */
function adoptCatalogue(ctx: OpenCtx, session: AcpNewSession): void {
  // 模型、强度、以及**它们各自设回哪儿**：一次算齐（见 `catalogOf`）
  adoptCatalog(ctx.state, catalogOf(session, localeOf(ctx.req)))
  ctx.state.modes = modesOf(session)
  ctx.state.mode = currentModeOf(session)
  ctx.state.windowOf = contextWindows(session)
  const current = session.models?.currentModelId
  ctx.state.contextWindow = current === undefined ? undefined : ctx.state.windowOf[current]
}

/** 认领一个刚开出来（或分出来）的会话：记下 id，再认领目录。 */
function adopt(ctx: OpenCtx, created: AcpNewSession): void {
  const id = created.sessionId
  if (id === undefined) throw new Error(ACP_OPEN[localeOf(ctx.req)].noSessionId(ctx.config.id))
  ctx.state.acpSession = id
  ctx.req.onHandle?.(id)
  adoptCatalogue(ctx, created)
}
