import type { ThreadId } from "@omni/protocol"
import { emit, type Ctx } from "./ctx.js"

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
