import type { EngineCapabilities, ModelOption, Trust } from "@omni/protocol"
import type { StartRequest } from "../contract.js"
import type { ProcessOwner } from "../subprocess.js"
import type { RpcPeer } from "../rpc.js"
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
import type { AcpInitialize, AcpNewSession } from "./wire.js"

/**
 * 一条 ACP 会话**怎么开场**：握手、开新的 / 续上一条 / 分一条出来。
 *
 * 从驱动里拆出来是行数闸门逼的，但边界本来就该有：驱动的日常是收通知、发提示词、
 * 落事件；开场只发生一次，而它恰恰是最容易出错、也最该被单独读一遍的一段
 * （版本不合、能力对不上、句柄接不回来，都在这几十行里）。
 */

const PROTOCOL_VERSION = 1
const CLIENT_INFO = { name: "omni", title: "omni 同文", version: "0.1.0" }
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
  /** 当前信任档。开场时要按它挑 mode。 */
  trust: string
  /**
   * 开会话时按信任档算出来的原生审批开关。
   *
   * 留着它有两个用处：那句要对用户说的话（`note`），
   * 以及中途换档时判断「开会话时定死的那个值和现在要的还一样吗」。
   */
  native: Native | undefined
  /** 子进程的 stderr 尾巴。握手超时要把它摊出来，不然只有一句「超时了」。 */
  stderr: string
}

export interface OpenCtx {
  rpc: RpcPeer
  owner: ProcessOwner
  /** 只声明开场用得到的那几项。**不直接引 `AcpDriverConfig`**：那会绕成
      driver → open → driver 的循环 import。 */
  config: { id: string; command: string; nativeApproval?: (trust: Trust) => Native }
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
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: CLIENT_INFO,
    }),
    ctx.owner.died().then((error) => ({ died: error })),
    sleep(HANDSHAKE_MS).then(() => "timeout" as const),
  ])
  if (result === "timeout") {
    const tail = ctx.state.stderr === "" ? "" : `\n${ctx.state.stderr}`
    throw new Error(`${ctx.config.id} 在 ${String(HANDSHAKE_MS / 1000)} 秒内没有完成握手，已放弃。${tail}`)
  }
  if (typeof result === "object" && result !== null && "died" in result) {
    throw new Error(startupMessage(ctx.config.command, (result as { died: Error }).died))
  }
  const info = result as AcpInitialize
  const version = info.protocolVersion
  // 版本不合就直接说。协议原文：客户端不支持返回的版本时应当断开
  if (version !== undefined && version > PROTOCOL_VERSION) {
    throw new Error(
      `${ctx.config.id} 讲的是 ACP v${String(version)}，omni 只认到 v${String(PROTOCOL_VERSION)}。请升级 omni。`,
    )
  }
  ctx.state.loadSession = info.agentCapabilities?.loadSession === true
  // **能力由 agent 自报，不由 omni 猜**：同一个驱动接的几家本来就不一样。
  // 但「没声明」只是没声明——实测 grok 的能力表是空的，`session/list` 却能答，
  // 所以这里留 undefined，由 `history()` 问一次再定（见那边的注释）
  ctx.state.canList = canList(info) ? true : undefined
  return capabilitiesOf(info)
}

/**
 * 开会话。带句柄就 `session/load` 续跑。
 *
 * **agent 不支持 `loadSession` 时不能静默新开**——用户会以为上下文还在，
 * 实际模型什么都不记得。宁可把失败摆出来（和 codex 驱动同一条原则）。
 */
export async function openSession(ctx: OpenCtx): Promise<void> {
  // **原生审批开关只在开会话时能设**（grok 的 `yoloMode` 在 `session/new` 里），
  // 所以它必须在这儿算好，而且续跑/分叉那两条路也要带上——
  // 只给新会话带的话，接着跑的那条会话会悄悄退回引擎自己的默认档
  const native = ctx.config.nativeApproval?.(ctx.req.trust as Trust)
  ctx.state.native = native
  const shared: Shared = {
    cwd: ctx.req.cwd,
    mcpServers: [],
    ...(native?.meta === undefined ? {} : { _meta: native.meta }),
  }
  if (ctx.req.forkOf !== undefined) {
    await forkSession(ctx, ctx.req.forkOf.handle, shared)
    return
  }
  if (ctx.req.resume !== undefined) {
    if (!ctx.state.loadSession) {
      throw new Error(`${ctx.config.id} 不支持续跑（没有 loadSession 能力），这个会话没法接着上次跑。`)
    }
    await ctx.rpc.call("session/load", { sessionId: ctx.req.resume, ...shared })
    ctx.state.acpSession = ctx.req.resume
    ctx.req.onHandle?.(ctx.req.resume)
    // 档位由调用方在开场之后统一施加（见驱动里的 openSession）
    void (ctx.state.trust, [])
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
 * ACP 没有「只保留前 N 轮」的入口，所以 `dropTurns` 用不上——
 * **不假装支持**：宿主那边「从这一轮重来」在这家引擎上会带上完整历史。
 */
async function forkSession(ctx: OpenCtx, handle: string, shared: Shared): Promise<void> {
  const forked = (await ctx.rpc.call("session/fork", { sessionId: handle, ...shared })) as AcpNewSession
  adopt(ctx, forked)
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

/** 认领一个刚开出来（或分出来）的会话：记下 id、模型、档位、强度。 */
function adopt(ctx: OpenCtx, created: AcpNewSession): void {
  const id = created.sessionId
  if (id === undefined) throw new Error(`${ctx.config.id} 没有返回 sessionId，无法继续`)
  ctx.state.acpSession = id
  ctx.req.onHandle?.(id)
  // 模型、强度、以及**它们各自设回哪儿**：一次算齐（见 `catalogOf`）
  adoptCatalog(ctx.state, catalogOf(created))
  ctx.state.modes = modesOf(created)
  ctx.state.mode = currentModeOf(created)
  ctx.state.windowOf = contextWindows(created)
  const current = created.models?.currentModelId
  ctx.state.contextWindow = current === undefined ? undefined : ctx.state.windowOf[current]
}
