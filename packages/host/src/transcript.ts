import type { Item, Thread } from "@switchback/protocol"
import { emit, type Ctx } from "./ctx.js"

/**
 * 把一段已有的对话搬进某个会话的 transcript。
 *
 * 两处要用，所以独立成一个文件（留在任何一边都会和 `session.ts` 成环）：
 *
 * - **原生分叉**：引擎复制了会话，Switchback 这边也得有同一段记录
 * - **接管引擎侧会话**：Claude 的历史文件里有全文，读出来摆上
 *
 * 两者面对的是同一个问题——**引擎记得，而 Switchback 的记录是按会话分文件存的**。
 * 不搬的话你看到一个空对话，而它其实什么都记得；
 * 「看起来丢了但其实没丢」比真丢了更难受：你会把说过的话再说一遍。
 */

/**
 * 把上下文抄进新会话的 transcript。
 *
 * 引擎那边已经什么都记得（原生 fork 复制的是真的会话），但 Switchback 的记录是
 * **按会话分文件存的**——不抄的话你看到的是一个空对话，而它其实记得一切。
 * 「看起来丢了但其实没丢」比真丢了更难受：你会把已经说过的话再说一遍。
 *
 * ## turn id 必须重新铸
 *
 * journal 按 `turnOwner` 分文件。沿用旧的 turn id，抄过来的记录会被写进
 * **原会话**的文件里——两条会话从此互相污染，而且是静默的。
 * item id 一起重铸：反正 store 是按会话分表存的，重铸不花什么代价。
 *
 * 每一轮都补一条 `turn.completed`，否则界面上它们永远停在「正在跑」。
 */
export function copyTranscript(ctx: Ctx, thread: Thread, items: readonly Item[]): void {
  const minted = new Map<string, string>()
  for (const item of items) {
    let turnId = minted.get(item.turnId)
    if (turnId === undefined) {
      turnId = ctx.deps.newId("tn")
      minted.set(item.turnId, turnId)
      ctx.turnOwner.set(turnId, thread.id)
      emit(ctx, {
        type: "turn.started",
        at: item.at,
        turn: { id: turnId, threadId: thread.id, engine: thread.engine, status: "running", startedAt: item.at },
      })
    }
    emit(ctx, {
      type: "item.started",
      at: item.at,
      item: { ...item, id: ctx.deps.newId("it"), turnId, inherited: true },
    })
  }
  const last = items[items.length - 1]?.at ?? ctx.deps.now()
  for (const turnId of minted.values()) {
    emit(ctx, { type: "turn.completed", at: last, turnId, status: "completed" })
  }
}
