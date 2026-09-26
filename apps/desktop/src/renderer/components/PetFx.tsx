import type { EngineId, TurnPace } from "@omni/protocol"
import type { BrassMode, TrajMode } from "../../shared/settings.js"
import { PetFx } from "./PetFxCanvas.js"
import { lookOf, type Pet } from "../pets.js"
import type { PetSlot } from "../pet-roster.js"
import { useFlow } from "../useFlow.js"

/**
 * 开火那一层的**接线**。画布本身在 `PetFxCanvas.tsx`——
 * 拆开是行数闸门逼的，但边界也顺：那边是一整套自己转的动画，
 * 这边只回答「这一刻该不该有这一层、它属于哪一只」。
 */

export interface FireProps {
  /** 要不要开火。 */
  on: boolean
  /** 哪条会话。流速只算这一条的——理由见 `flow-scope.ts`。 */
  threadId: string
  /** 这一轮在不在跑。 */
  running: boolean
  /** 手里有别的东西（在等审批）：这时枪立刻收起来。 */
  handsBusy: boolean
  /** 上下文用了多满（0~1）。上下文快满时会来胖子。 */
  ctxRatio: number
  /** 让不让压力显形。 */
  foes: boolean
  /** 弹壳归谁。 */
  brass: BrassMode
  /** 弹丸打到哪儿去。 */
  traj: TrajMode
  /** 打靶。 */
  range: boolean
  /** 这条会话上一轮的成绩（宿主量好落了盘的那份）。靶上那行印它。 */
  last: TurnPace | undefined
}

/**
 * 开火那一层。**它和上面那几只完全不相干**：只读 `pets` 里那只的坐标，
 * 从不改它，也从不被它读（见 `pet-fx.ts` 开头）。关掉它的时候桌宠一切照旧。
 *
 * 单拎成一个组件不只是行数：`useFlow` 要挂在**一直在的地方**——
 * 挂在条件分支里的话，关掉再打开会重订一次桥、重开一个滑窗。
 */
export function FireLayer({
  pets,
  homeAt,
  slots,
  engine,
  fire,
  reduced,
  onBite,
}: {
  pets: React.RefObject<Pet[]>
  /** 那只的**窝**在哪。靶钉在这上面，不钉在它身上——见 `pet-range.ts`。 */
  homeAt: (index: number) => { x: number; y: number } | undefined
  slots: readonly PetSlot[]
  engine: EngineId
  fire: FireProps
  reduced: boolean
  onBite: () => void
}): React.JSX.Element | null {
  const flow = useFlow(fire.threadId)
  const mine = slots.findIndex((slot) => slot.engine === engine)
  if (!fire.on || reduced || mine < 0) return null
  const look = lookOf(engine)
  return (
    <PetFx
      pets={pets}
      homeAt={homeAt}
      index={mine}
      threadId={fire.threadId}
      tone={look.tone}
      shape={look.shape}
      flow={flow}
      last={fire.last}
      busyHands={fire.handsBusy}
      running={fire.running}
      ratio={fire.ctxRatio}
      foes={fire.foes}
      brass={fire.brass}
      traj={fire.traj}
      range={fire.range}
      onBite={onBite}
    />
  )
}
