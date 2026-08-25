import type { EngineId } from "@omni/protocol"
import { PetArt } from "./pets-art.js"
import type { PetSlot } from "../pet-roster.js"
import type { EntryKind } from "../pet-entry.js"
import type { PetDrag } from "../usePetDrag.js"
import { DshPetEffect, type DshPetPhase } from "./DshPetEffect.js"

/**
 * 一只桌宠身上的那几层，外加影子那一组。
 *
 * 从 `Pets.tsx` 拆出来是行数闸门逼的，边界也说得过去：那边管**这一刻台面上有谁**
 *（花名册、座位表、物理、拖拽），这边只管**一只长什么样**。
 *
 * ## 三层为什么不能合并
 *
 * `.pet` 写位置、`.pet__lean` 写倾斜与抻长、`.pet__body` 演动画——
 * `transform` 只有一个，合成一层的话三者会互相盖掉（见 `petPaint.ts`）。
 */

/** 一只。**单拎出来是行数闸门逼的**，但它也确实是一整件事：一只的全部长相。 */
export function PetOne({
  info,
  at,
  look,
  refs,
  drag,
}: {
  info: PetSlot
  at: number
  look: {
    engine: EngineId
    running: boolean
    dshPhase: DshPetPhase
    entry: EntryKind | undefined
    profile?: string
  }
  refs: {
    nodes: React.RefObject<(HTMLButtonElement | null)[]>
    leans: React.RefObject<(HTMLSpanElement | null)[]>
    bodies: React.RefObject<(HTMLSpanElement | null)[]>
  }
  drag: PetDrag
}): React.JSX.Element {
  const on = info.engine === look.engine
  return (
    <button
      type="button"
      ref={(n) => {
        refs.nodes.current[at] = n
      }}
      className={classOf(info, look.engine, look.running, look.dshPhase) + enterOf(on, look.entry)}
      title={titleOf(info.label, on, look.running, info.engine === "dsh" ? look.profile : undefined)}
      onPointerDown={drag.down(at)}
      onPointerMove={drag.move}
      onPointerUp={drag.up}
      onPointerCancel={drag.up}
      onLostPointerCapture={drag.lost}
    >
      {info.engine === "dsh" && on ? <DshPetEffect phase={look.dshPhase} /> : null}
      <Ripple on={on && look.entry === "splash"} />
      {/* 状态点在**头顶**，不在脚下。挂在脚下时它垫在身子和地面之间，
          三只看起来全都悬空——而它们本来是站在输入框上沿的，那条边就是地面 */}
      {on && look.running ? <span className="pet__dot" /> : null}
      <span
        className="pet__lean"
        ref={(n) => {
          refs.leans.current[at] = n
        }}
      >
        <Canopy on={on && look.entry === "chute"} />
        <span
          className="pet__body"
          ref={(n) => {
            refs.bodies.current[at] = n
          }}
        >
          <PetArt shape={info.look.shape} />
        </span>
      </span>
    </button>
  )
}

/**
 * 影子那一组。**和身体分开、且摆在前面**：影子钉在地面上不跟着抬
 *（见 `petPaint.ts`），那是「它离地多高」唯一的说法；摆在前面所以永远压在身体下面。
 */
export function Shades({
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

