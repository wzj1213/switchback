import { memo, useCallback, useMemo, useRef } from "react"
import type { EngineId, EngineInfo } from "@switchback/protocol"
import { PetOne, Shades } from "./PetParts.js"
import { gaitOf, lookOf, type Hit, type Pet } from "../pets.js"
import { petRoster, visibleRoster } from "../pet-roster.js"
import type { Seat } from "../pet-seats.js"
import { usePetEntry } from "../usePetEntry.js"
import { FireLayer, type FireProps } from "./PetFx.js"
import { usePets } from "../usePets.js"
import { useReduced } from "../use-reduced.js"
import { useMood } from "../usePetMood.js"
import { usePetDrag } from "../usePetDrag.js"
import { applyHit } from "../pet-hit-fx.js"
import { useDshPetPhase } from "./DshPetEffect.js"
import { useLocale } from "../i18n.js"

/**
 * 蹲在输入框上沿的那几只。手感与物理在 `renderer/pets.ts`，机械部分在 `usePets.ts`。
 *
 * ## 它们什么时候动
 *
 * **静止是常态。** 最初那版设计稿给了三条 `infinite` 动画（蹦 1.8s、左右溜达 8s、
 * 眨眼 3.6s），闲着也在跑，而位置正在你打字时视线停的那个点上——
 * 而这个仓库早就把这件事想清楚过了，`status.css` 里那段：「一刻不停的加载动画会
 * 持续抢注意力；这里是隔一段扫一道」。推理微光按那条规矩收着了，吉祥物没有。
 *
 * 现在只有两种情况会动：**这一轮真在跑**（当前那只按微光同一个节拍跳，
 * 关键帧和原案逐帧相同，只是频率降到十三分之一），以及**你在动它**。
 * 于是跳这件事不再是装饰，它是个状态指示：它在动 = 它在干活。
 *
 * ## 拖、扔、走回来
 *
 * 活动区是整块对话区（`.stage`）。捏起来能拖到任何地方，松手按重力落到地面——
 * 地面就是活动区的底边，也就是输入框的上沿、它们本来站的那条线。落地之后自己
 * 走回右下角的窝。**它永远回得来**，所以怎么扔都不会把它弄丢。
 *
 * 点一下是纯玩：被点的蹦一下，左右邻居探个头。**不换引擎**——换引擎在输入框
 * 那颗下拉里，一个玩的动作不该有副作用。
 */

function PetsView({
  engines,
  engine,
  running,
  active,
  failed,
  profile,
  hidden,
  entryOn,
  fire,
}: {
  engines: readonly EngineInfo[]
  engine: EngineId
  running: boolean
  active: boolean
  failed: boolean
  profile?: string
  /** 用户在设置里藏起来的那几只（花名册的 key）。当前那家藏不掉，见 `visibleRoster`。 */
  hidden: readonly string[]
  /** 换引擎时播不播登场。系统「减少动效」开着时这里再堵一道。 */
  entryOn: boolean
  /**
   * 开火那一层要的一切。**打包成一项**：这几个值全都只为 `FireLayer` 存在，
   * 单独摆在这里等于让桌宠本体去关心一件它根本不参与的事——
   * 而每加一项，本体的参数表就长一行、行数闸门就近一步（实测两次都是这么撞上的）。
   */
  fire: FireProps
}): React.JSX.Element | null {
  const locale = useLocale()
  const shown = useMemo(
    () => visibleRoster(petRoster(engines, engine, locale), engine, hidden),
    [engines, engine, hidden, locale],
  )
  const count = shown.length
  /**
   * 座位表。**key 和步态打包成一件事**：它们总是一起变，而分成两个 memo 之后
   * 「换了谁」这件事就得由两个数组各说一遍——`usePets` 里那次按下标对齐的事故
   * （见 `pet-seats.ts`）正是从「两边各说各的」开始的。
   */
  const seats = useMemo<readonly Seat[]>(
    () => shown.map((slot) => ({ key: slot.key, gait: gaitOf(slot.look.shape) })),
    [shown],
  )
  const bodies = useRef<(HTMLSpanElement | null)[]>([])
  const reduced = useReduced()
  const dshPhase = useDshPetPhase(engine === "dsh" && active, failed)
  // 砸到地上要有分量、挨了一下要有方向、砸得够重旁边的要跟着震：
  // 那一整套写在 `pet-hit-fx.ts` 里，这里只负责把当时的两组节点递过去
  const onHit = useCallback(
    (index: number, hit: Hit) => {
      applyHit({ bodies: bodies.current, nodes: ctl.nodes.current }, index, hit, reduced)
    },
    [reduced],
  )
  // 被摸到脸上：**横着挨一记**（压瘦，不是压扁）。挨打的方向就是刚才发生了什么
  // 的全部内容，而这一下是从左边来的
  const onBite = useCallback(() => {
    const at = shown.findIndex((slot) => slot.engine === engine)
    if (at < 0) return
    applyHit({ bodies: bodies.current, nodes: ctl.nodes.current }, at, BITE, reduced)
  }, [reduced, shown, engine])
  const ctl = usePets(seats, onHit)
  // **只给待在窝里、又不是正在跑的那几只排班**——理由在 `usePetMood` 开头
  useMood(ctl.nodes, ctl.pets, count, reduced)
  const drag = usePetDrag(ctl, bodies, reduced, seats)
  const entry = usePetEntry(engine, lookOf(engine), entryOn && !reduced)

  if (count === 0) return null

  return (
    <div className="pets" ref={ctl.area} aria-hidden="true">
      <FireLayer
        pets={ctl.pets}
        homeAt={ctl.homeAt}
        slots={shown}
        engine={engine}
        fire={fire}
        reduced={reduced}
        onBite={onBite}
      />
      <Shades slots={shown} refs={ctl.shades} />
      {shown.map((info, i) => (
        <PetOne
          key={info.key}
          info={info}
          at={i}
          look={{ engine, running, dshPhase, entry, profile }}
          refs={{ nodes: ctl.nodes, leans: ctl.leans, bodies }}
          drag={drag}
        />
      ))}
    </div>
  )
}

/**
 * 被摸到脸上那一下。**横向**：`squash` 会顺着挨打的方向压，
 * 从天上砸下来是压扁、横着挨一记是压瘦——而方向恰恰是「刚才发生了什么」的全部内容。
 * 速度定在会眯一下眼那一档之上：这一下该看得出来。
 */
const BITE: Hit = { axis: "x", speed: 1500 }

/**
 * **memo 不是优化，是止血。**
 *
 * `Workspace` 在流式输出时每一批事件重渲染一次（一秒可以几十次），而这一整块
 * 在那几十次里没有任何一处该变：位置每帧由 rAF 直接写 DOM，眨眼由 `useMood`
 * 直接写 classList，开火那层是一张自己转的 canvas。不挡住的话，每一批事件都要
 * 白白重挂五个按钮的三组 ref（内联箭头 ref 每次渲染都会被 React 先置空再重设）。
 *
 * 挡得住的前提是**上游别递新对象**——`fire` 那一包在 `Workspace` 里是 memo 过的。
 */
export const Pets = memo(PetsView)

export type { Pet }
