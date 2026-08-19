import type { Event, ItemId, PlanStep, TurnId } from "@omni/protocol"
import type { WirePlanUpdate } from "./wire.js"

/**
 * codex 的 `turn/plan/updated` → omni 的 `plan` item。
 *
 * ## 为什么这一路比 claude 那一路短这么多
 *
 * codex **每次推的都是整份计划**（`plan: Vec<TurnPlanStep>`），
 * 和 ACP 的 `plan` 更新是同一种形状。claude 那边是 `TaskCreate` / `TaskUpdate`
 * 一条条来的，所以 `claude/plan.ts` 得自己攒一份并按创建序发号；
 * 这里整份替换就行，不需要任何跨消息的状态。
 *
 * ## item id 不用铸，从轮次推出来
 *
 * `turn/plan/updated` 是**轮次级**的通知，线上没有 item id 可用。
 * 用 `plan-<turnId>` 而不是发一个新号：
 *
 * - 同一轮里反复更新，算出来是同一个 id ——界面上就是**同一张卡在变**，
 *   而不是每改一步多一张；
 * - 换一轮自然换 id，不必在轮次收尾时记得清什么。少一处能忘的清理。
 *
 * 「这个 id 发过 `item.started` 没有」直接问 `materialized`——
 * 那个集合本来就是干这个的，不必再养一份。
 *
 * ## 没有实验面
 *
 * `turn/plan/updated` 在 `common.rs` 里**没有 `#[experimental(...)]`**
 *（对照 `thread/settings/updated` 是有的），所以 `claims.ts` 不用加认领。
 * 装着的 0.148.0 二进制里能搜到这个方法名。
 */

/**
 * codex 的状态词 → omni 的四态。
 *
 * 两种大小写都收，理由见 `WirePlanUpdate` 的注释：同一个枚举在 codex 仓库里
 * 有 snake / camel 两份序列化，线上这条是 camel 的那份。
 *
 * **认不出的一律当 `pending`**：猜错的方向必须是「显示成还没做」，
 * 不能是「显示成做完了」。和 `claude/plan.ts` 同一条取舍。
 */
const STATUS: Readonly<Record<string, PlanStep["status"]>> = {
  pending: "pending",
  inProgress: "in_progress",
  in_progress: "in_progress",
  completed: "done",
}

export interface PlanCtx {
  turnId: () => TurnId | undefined
  materialized: Set<ItemId>
  emit: (event: Event) => void
  now: () => number
}

/** 这一轮的计划卡 id。见文件头「item id 不用铸」。 */
export function planItemId(turnId: TurnId): ItemId {
  return `plan-${turnId}`
}

function toStep(entry: { step?: string; status?: string }): PlanStep {
  return { text: entry.step ?? "", status: STATUS[entry.status ?? ""] ?? "pending" }
}

/**
 * 吃一条计划更新。
 *
 * **空计划不发**：codex 会在轮次开头推一条 `plan: []`，发出去就是一张空卡。
 * 已经发过之后再收到空的也不发——那多半是它在重置，而把一张有内容的卡
 * 就地清空，读的人只会以为是自己看漏了。
 */
export function onPlanUpdate(ctx: PlanCtx, params: WirePlanUpdate): void {
  const turnId = ctx.turnId()
  if (turnId === undefined) return
  const steps = (params.plan ?? []).map(toStep)
  if (steps.length === 0) return
  const id = planItemId(turnId)
  const started = ctx.materialized.has(id)
  ctx.materialized.add(id)
  const at = ctx.now()
  const explanation = params.explanation ?? undefined
  ctx.emit({
    type: started ? "item.updated" : "item.started",
    at,
    item: {
      id,
      turnId,
      at,
      kind: "plan",
      steps,
      ...(explanation === undefined || explanation === "" ? {} : { explanation }),
    },
  })
}
