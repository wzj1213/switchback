import type { EngineStatus, ModelOption } from "@switchback/protocol"
import { modelCall, sayWhy } from "./setup.js"

/**
 * 换模型、换推理强度**怎么落到引擎上**。
 *
 * 和 `mode.ts` 同一个边界：那边是「信任档怎么落到引擎上」，这边是
 * 「模型和强度怎么落到引擎上」。都是「界面选了一个值 → 发哪一发 RPC →
 * 发不出去怎么向用户交代」。
 *
 * ## 为什么这件事需要一个模块，而不是驱动里的两行
 *
 * 因为「发哪一发」不是常数，而是**由 agent 开会话时报清单的方式决定的**
 * （见 `modelCatalogOf`）。一律发规范拼写的 `session/set_model` 是实测炸过的：
 * ZCode 的桥只实现了 `session/set_config_option`，规范那条在它那儿是
 * `Method not found`——于是点一下模型下拉，界面上弹一条红色的「引擎故障」，
 * 而用户什么都没做错。
 */
export interface ModelCtx {
  /** 引擎 id，落进给用户的那句话里。 */
  id: string
  call: (method: string, params: unknown) => Promise<unknown>
  status: (status: EngineStatus, detail?: string) => void
  state: {
    acpSession: string | undefined
    /** 换模型走哪条路（见 `OpenState.modelConfig`）。 */
    modelConfig: string | undefined
    /** 换强度要报的 configId（kimi `thinking`、ZCode `thought`）。 */
    effortConfig: string | undefined
    /** 当前模型清单。**判「强度走哪条路」要看它**：见 `metaRoute`。 */
    models: readonly ModelOption[]
    effort: string | undefined
    windowOf: Readonly<Record<string, number>>
    contextWindow: number | undefined
  }
}

/**
 * 强度走**模型扩展位**那条路吗。
 *
 * 两条路互斥，判据是「清单从哪儿读来的，就设回哪儿」——和 `modelCall` 同一条原则：
 *
 * - 有 `effortConfig` = 强度是个独立的 `configOption`（kimi 的 `thinking`、ZCode 的 `thought`），
 *   单独发一次 `session/set_config_option`。
 * - 没有、而目标模型自己带着 `efforts` = 它来自 `_meta.reasoningEfforts`（实测 grok），
 *   **那就折进同一发 `session/set_model` 的 `_meta` 里**——grok 自己的客户端正是这么发的
 *  （`SetSessionModelRequest…meta(REASONING_EFFORT_META_KEY)`）。
 */
function metaRoute(ctx: ModelCtx, model: string): boolean {
  if (ctx.state.effortConfig !== undefined) return false
  return (ctx.state.models.find((m) => m.id === model)?.efforts ?? []).length > 0
}

/**
 * 换模型（可能连带换强度）。
 *
 * **强度有三种表达，同一个驱动要同时装下**：
 *
 * 1. 编进 modelId（codex 适配器的 `gpt-5.6-sol[low]`）——没有独立选项，跳过即可。
 * 2. 独立的会话选项（kimi 的 `thinking`、ZCode 的 `thought`）——单独发一次
 *    `session/set_config_option`，见 `applyEffort`。
 * 3. **模型清单的扩展位**（实测 grok 的 `_meta.reasoningEfforts`）——折进同一发
 *    `session/set_model` 的 `_meta`，见 `metaRoute`。
 *
 * 这正是「一个抽象要同时装下几种形状，靠的不是求同，是把差异显式建模」。
 */
export async function applyModel(ctx: ModelCtx, model: string, effort?: string): Promise<{ effort?: string }> {
  const sessionId = ctx.state.acpSession
  if (sessionId === undefined) return {}
  const { method, params } = modelCall(ctx.state.modelConfig, sessionId, model)
  // 走扩展位那条路时，强度和模型是**同一发**——分两发的话中间那一刻模型换了、强度还是旧的
  const meta = effort !== undefined && metaRoute(ctx, model) ? { _meta: { reasoningEffort: effort } } : undefined
  await ctx.call(method, { ...params, ...meta }).catch((error: unknown) => {
    throw new Error(sayWhy(ctx.id, "换模型", error))
  })
  if (meta !== undefined) ctx.state.effort = effort
  else if (effort === undefined || ctx.state.effortConfig === undefined) ctx.state.effort = undefined
  // 分母跟着换：同一家的两个模型窗口可以不一样，不换的话比例条会按旧分母画
  ctx.state.contextWindow = ctx.state.windowOf[model]
  await applyEffort(ctx, sessionId, effort)
  // **回报的是引擎那边真正生效的那一档**，不是请求的那个：
  // 设不上时 `applyEffort` 只发 degraded，`ctx.state.effort` 停在旧值
  return ctx.state.effort === undefined ? {} : { effort: ctx.state.effort }
}

/**
 * 单独设一次推理强度。
 *
 * **设不上要出声。** 上一版是静默吞掉，理由是「模型那一步已经成了，不该把整件事
 * 算失败」——前半句对，后半句的代价是：界面把新档位显示出来了，而引擎那边什么都没变。
 * 现在照旧不算失败（模型确实换了），但发一条 `degraded`：
 * 那正是「引擎照跑，只是少了一样能力」该走的通道。
 */
async function applyEffort(ctx: ModelCtx, sessionId: string, effort?: string): Promise<void> {
  const configId = ctx.state.effortConfig
  if (effort === undefined || effort === ctx.state.effort || configId === undefined) return
  await ctx
    .call("session/set_config_option", { sessionId, configId, value: effort })
    .then(() => {
      ctx.state.effort = effort
    })
    .catch((error: unknown) => {
      ctx.status("degraded", sayWhy(ctx.id, "设推理强度", error))
    })
}
