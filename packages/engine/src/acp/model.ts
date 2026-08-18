import type { EngineStatus } from "@omni/protocol"
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
    effort: string | undefined
    windowOf: Readonly<Record<string, number>>
    contextWindow: number | undefined
  }
}

/**
 * 换模型（可能连带换强度）。
 *
 * 强度有两种表达：有的适配器把它编进 modelId（codex 适配器的 `gpt-5.6-sol[low]`），
 * 那时没有独立选项，跳过即可；有的把它做成独立的会话选项（kimi 的 `thinking`、
 * ZCode 的 `thought`），那时要单独发一次。**两条都走**，因为同一个驱动要接这两种。
 */
export async function applyModel(ctx: ModelCtx, model: string, effort?: string): Promise<{ effort?: string }> {
  const sessionId = ctx.state.acpSession
  if (sessionId === undefined) return {}
  const { method, params } = modelCall(ctx.state.modelConfig, sessionId, model)
  await ctx.call(method, params).catch((error: unknown) => {
    throw new Error(sayWhy(ctx.id, "换模型", error))
  })
  // 分母跟着换：同一家的两个模型窗口可以不一样，不换的话比例条会按旧分母画
  ctx.state.contextWindow = ctx.state.windowOf[model] ?? ctx.state.contextWindow
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
