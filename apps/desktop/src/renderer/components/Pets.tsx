import { useCallback, useMemo, useRef } from "react"
import type { EngineId, EngineInfo } from "@omni/protocol"
import { PetArt } from "./pets-art.js"
import { gaitOf, lookOf, type Hit, type Pet } from "../pets.js"
import { petRoster, visibleRoster, type PetSlot } from "../pet-roster.js"
import type { EntryKind } from "../pet-entry.js"
import { usePetEntry } from "../usePetEntry.js"
import { useFlow } from "../useFlow.js"
import { PetFx } from "./PetFx.js"
import { usePets, useReduced } from "../usePets.js"
import { useMood } from "../usePetMood.js"
import { usePetDrag } from "../usePetDrag.js"
import { applyHit } from "../pet-hit-fx.js"
import { DshPetEffect, useDshPetPhase, type DshPetPhase } from "./DshPetEffect.js"

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

export function Pets({
  engines,
  engine,
  running,
  active,
  failed,
  profile,
  hidden,
  entryOn,
  fireOn,
  threadId,
  handsBusy,
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
  /** 当前那只要不要按 token 流速开火。 */
  fireOn: boolean
  /** 哪条会话。流速只算这一条的——理由见 `flow-scope.ts`。 */
  threadId: string
  /** 手里有别的东西（在等审批）：这时枪立刻收起来。 */
  handsBusy: boolean
}): React.JSX.Element | null {
  const shown = useMemo(
    () => visibleRoster(petRoster(engines, engine), engine, hidden),
    [engines, engine, hidden],
  )
  const count = shown.length
  const gaits = useMemo(() => shown.map((slot) => gaitOf(slot.look.shape)), [shown])
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
  const ctl = usePets(count, gaits, onHit)
  // **只给待在窝里、又不是正在跑的那几只排班**——理由在 `usePetMood` 开头
  useMood(ctl.nodes, ctl.pets, count, reduced)
  const drag = usePetDrag(ctl, bodies, reduced)
  const entry = usePetEntry(engine, lookOf(engine), entryOn && !reduced)

  if (count === 0) return null

  return (
    <div className="pets" ref={ctl.area} aria-hidden="true">
      <FireLayer
        pets={ctl.pets}
        slots={shown}
        engine={engine}
        threadId={threadId}
        on={fireOn && !reduced}
        handsBusy={handsBusy}
      />
      <Shades slots={shown} refs={ctl.shades} />
      {shown.map((info, i) => (
        <button
          key={info.key}
          type="button"
          ref={(n) => {
            ctl.nodes.current[i] = n
          }}
          className={classOf(info, engine, running, dshPhase) + enterOf(info.engine === engine, entry)}
          title={titleOf(info.label, info.engine === engine, running, info.engine === "dsh" ? profile : undefined)}
          onPointerDown={drag.down(i)}
          onPointerMove={drag.move}
          onPointerUp={drag.up}
          onPointerCancel={drag.up}
        >
          {info.engine === "dsh" && info.engine === engine ? <DshPetEffect phase={dshPhase} /> : null}
          <Ripple on={info.engine === engine && entry === "splash"} />
          {/* 状态点在**头顶**，不在脚下。挂在脚下时它垫在身子和地面之间，
              三只看起来全都悬空——而它们本来是站在输入框上沿的，那条边就是地面 */}
          {info.engine === engine && running ? <span className="pet__dot" /> : null}
          <span
            className="pet__lean"
            ref={(n) => {
              ctl.leans.current[i] = n
            }}
          >
            <Canopy on={info.engine === engine && entry === "chute"} />
            <span
              className="pet__body"
              ref={(n) => {
                bodies.current[i] = n
              }}
            >
              <PetArt shape={info.look.shape} />
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}

/**
 * 影子那一组。**和身体分开、且摆在前面**：影子钉在地面上不跟着抬
 *（见 `petPaint.ts`），那是「它离地多高」唯一的说法；摆在前面所以永远压在身体下面。
 */
function Shades({
  slots,
  refs,
}: {
  slots: readonly PetSlot[]
  refs: React.RefObject<(HTMLSpanElement | null)[]>
}): React.JSX.Element {
  return (
    <>
      {slots.map((info, i) => (
        <span
          key={`shade-${info.key}`}
          className="pet__shade"
          ref={(n) => {
            refs.current[i] = n
          }}
        />
      ))}
    </>
  )
}

/**
 * 开火那一层。**它和上面那几只完全不相干**：只读 `pets` 里那只的坐标，
 * 从不改它，也从不被它读（见 `pet-fx.ts` 开头）。关掉它的时候桌宠一切照旧。
 *
 * 单拎成一个组件不只是行数：`useFlow` 要挂在**一直在的地方**——
 * 挂在条件分支里的话，关掉再打开会重订一次桥、重开一个滑窗。
 */
function FireLayer({
  pets,
  slots,
  engine,
  threadId,
  on,
  handsBusy,
}: {
  pets: React.RefObject<Pet[]>
  slots: readonly PetSlot[]
  engine: EngineId
  threadId: string
  on: boolean
  handsBusy: boolean
}): React.JSX.Element | null {
  const flow = useFlow(threadId)
  const mine = slots.findIndex((slot) => slot.engine === engine)
  if (!on || mine < 0) return null
  return <PetFx pets={pets} index={mine} tone={lookOf(engine).tone} flow={flow} busyHands={handsBusy} />
}

/**
 * 伞。**挂在 `.pet__lean` 里面**，跟着那只一起往下飘。
 *
 * 挂在外面（`.pet` 的直接子节点）时，蟹被 lean 的位移一路带下来、而伞钉在原地，
 * 于是两者会在半路穿过对方——实测下落到一半时伞正好整个藏在蟹身后。
 * 伞和被它吊着的那只是同一件事，位移只该写一份。
 */
function Canopy({ on }: { on: boolean }): React.JSX.Element | null {
  return on ? <span className="pet__chute" /> : null
}

/**
 * 水花。和伞相反，**必须挂在 lean 外面**：它是地面上炸开的一圈涟漪，
 * 不该跟着鲸一起跃到半空去。
 *
 * 两种都写成字面类名而不是拼出来的：拼的类名**静态查不出来**，
 * 而这个仓库有一道守卫专查「组件用到的 class 有没有规则」（`pnpm check:css`）。
 */
function Ripple({ on }: { on: boolean }): React.JSX.Element | null {
  return on ? <span className="pet__splash" /> : null
}

/** 登场那一拍挂在当前那只身上。空串表示这一刻没有登场在播。 */
function enterOf(on: boolean, kind: EntryKind | undefined): string {
  return on && kind !== undefined ? ` pet--enter-${kind}` : ""
}

/** 眨眼、瞟眼、被捏着、走路那几个类**不在这儿**——它们每秒都可能变，
    由 `useMood` / `usePetDrag` / `petPaint` 直接写 `classList`，不换一次重渲染。 */
function classOf(
  info: PetSlot,
  current: EngineId,
  running: boolean,
  dshPhase: DshPetPhase,
): string {
  const { look } = info
  const on = info.engine === current
  return [
    "pet",
    `pet--${look.tone}`,
    `pet--${look.shape}`,
    info.engine === undefined ? "pet--placeholder" : "",
    on ? "pet--on" : "",
    on && running ? "pet--run" : "",
    on && look.tone === "dsh" ? `pet--dsh-${dshPhase}` : "",
  ]
    .filter((c) => c !== "")
    .join(" ")
}

function titleOf(label: string, on: boolean, running: boolean, profile?: string): string {
  if (!on) return label
  const routed = profile === undefined ? label : `${label} · ${profile} profile`
  return running ? `${routed} · 正在跑` : `${routed} · 这一轮归它`
}

export type { Pet }
