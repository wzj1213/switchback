import type { Command, EngineAxis, ThreadId, TrustApply } from "@omni/protocol"
import { emit, isCurrent, type Ctx } from "./ctx.js"

/**
 * **引擎那边先发生、omni 后知道**的那些变化，落到 `Thread` 上并广播。
 *
 * 单独一个文件是因为它们和这个包里其余东西方向相反：别处是「用户点了什么 →
 * 让引擎去做」，这里是「引擎报了什么 → 改我们的记录」。驱动手上只有 `emit`、
 * 碰不到 `Thread`（见 `StartRequest.onHandle` / `onModel`），所以这条回上来的路
 * 必须有人接，接的地方就是这儿。
 */
/**
 * 记下引擎那边的会话句柄。
 *
 * 走 `thread.updated` 而不是私存一份：那样它才会跟着事件流落盘，
 * 下次启动读回来就在 `Thread` 上——**续跑需要的东西必须和历史存在同一个地方**，
 * 否则总有一天会出现「历史在但句柄丢了」。
 */
export function rememberHandle(ctx: Ctx, id: ThreadId, handle: string): void {
  const entry = ctx.live.get(id)
  if (entry === undefined || entry.thread.engineHandle === handle) return
  const at = ctx.deps.now()
  entry.thread = { ...entry.thread, engineHandle: handle, updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/**
 * 引擎**自己**换了模型 / 强度：记下来并广播。
 *
 * 和上面那条同一个模子，也同一个理由——**都是引擎那边先发生、omni 后知道**，
 * 而驱动碰不到 `Thread`，只能把结果递上来由这里落（见 `StartRequest.onModel`）。
 *
 * 没变就不发。`undefined` 的那一项一律**不动原值**：「引擎没报这一项」和
 * 「引擎报了个空」必须分开，把前者当后者会悄悄清掉用户选过的档。
 */
export function rememberModel(ctx: Ctx, id: ThreadId, model?: string, effort?: string): void {
  const entry = ctx.live.get(id)
  if (entry === undefined) return
  const kept = entry.thread
  if ((model ?? kept.model) === kept.model && (effort ?? kept.effort) === kept.effort) return
  const at = ctx.deps.now()
  const patch = { ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) }
  entry.thread = { ...kept, ...patch, updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/**
 * 引擎自报的状态：**合并进 `Thread.engineState`，绝不碰 `Thread.trust`。**
 *
 * 合并而不是覆盖，因为引擎往往一次只报一样（一条 `current_mode_update` 只带档位，
 * 一条 `config_option_update` 只带模型）。整份覆盖的话，后到的那条会把先到的抹掉。
 *
 * 轴按 `axis` 去重、后到的赢：codex 的 approval 与 sandbox 是两条独立的轴，
 * 各自更新各自的，不该互相清空。
 */
export function rememberEngineState(
  ctx: Ctx,
  id: ThreadId,
  patch: { axes?: readonly EngineAxis[]; modelId?: string },
): void {
  const entry = ctx.live.get(id)
  if (entry === undefined) return
  const prev = entry.thread.engineState
  const byAxis = new Map((prev?.axes ?? []).map((a) => [a.axis, a]))
  for (const axis of patch.axes ?? []) byAxis.set(axis.axis, axis)
  // **合并，不是覆盖**：`undefined` 一律当「这次没报」，沿用上一次的值
  const modelId = patch.modelId ?? prev?.modelId
  const at = ctx.deps.now()
  entry.thread = {
    ...entry.thread,
    engineState: {
      axes: [...byAxis.values()],
      ...(modelId === undefined ? {} : { modelId }),
      at,
    },
    updatedAt: at,
  }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/** omni 设档的结果。同一个模子，只是这一条是「omni 做了什么」而不是「引擎报了什么」。 */
export function rememberTrustApply(ctx: Ctx, id: ThreadId, result: TrustApply): void {
  const entry = ctx.live.get(id)
  if (entry === undefined) return
  const at = ctx.deps.now()
  entry.thread = { ...entry.thread, trustApply: result, updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}

/**
 * 问一句不打断主线的问题。
 *
 * **答案落进 `Thread.asides`，不进 transcript**——那是「侧问」的定义。
 * 走 `thread.updated` 因此白捡三样：落盘、⌘R 之后还在、手机端也读得到。
 *
 * 引擎不实现就直接抛：界面本来就不该给这个入口（能力位报 false），
 * 走到这里说明有别的地方在乱发命令，**静默吞掉会让那个 bug 一直藏着**。
 */
export async function sideQuestion(
  ctx: Ctx,
  cmd: Extract<Command, { type: "thread.sideQuestion" }>,
): Promise<void> {
  const entry = ctx.live.get(cmd.threadId)
  if (entry === undefined) throw new Error(`会话不存在：${cmd.threadId}`)
  if (!isCurrent(ctx, entry)) throw new Error("会话正在切换或重启，暂时不能侧问")
  const ask = entry.session.askAside
  if (ask === undefined) throw new Error(`${entry.thread.engine} 不支持侧问`)
  const question = cmd.text.trim()
  if (question === "") return
  const answer = await ask.call(entry.session, question)
  // 侧问期间允许用户去做别的；若已经接力，答案仍属于旧引擎，不能覆盖新 Thread。
  if (!isCurrent(ctx, entry)) return
  const at = ctx.deps.now()
  entry.thread = { ...entry.thread, asides: [...(entry.thread.asides ?? []), { at, question, answer }], updatedAt: at }
  emit(ctx, { type: "thread.updated", at, thread: entry.thread })
}
