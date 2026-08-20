import { useCallback, useMemo, useRef } from "react"
import type { EngineId, EngineInfo } from "@omni/protocol"
import { Crab, Slime } from "./pets-art.js"
import { gaitOf, lookOf, type Hit, type Pet, type PetLook } from "../pets.js"
import { usePets, useReduced } from "../usePets.js"
import { useMood } from "../usePetMood.js"
import { usePetDrag } from "../usePetDrag.js"

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

/** 最多画几只。引擎注册表是开放的，六只排一排就不是点缀是仪仗队了。 */
const MAX = 4

/** 旁边那只被震一下：往上一弹再落回去。比「探头」短促——那是好奇，这是被吓到 */
const JOLT: Keyframe[] = [
  { transform: "translateY(0) scale(1, 1)" },
  { transform: "translateY(-3px) scale(0.97, 1.04)", offset: 0.35 },
  { transform: "translateY(0) scale(1.04, 0.97)", offset: 0.7 },
  { transform: "translateY(0) scale(1, 1)" },
]

/** 砸得比这轻就不惊动旁边的——轻轻放下不该让全场抖一下 */
const JOLT_AT = 900

/** 挨得够狠才眯一下眼（一记「哎哟」）。**不能每次落地都眯**——
    蹦回窝的每一跳都算落地，每跳眯一次就成了抽搐 */
const WINCE_AT = 700
const WINCE_MS = 220

/** 眯一下眼。复用眨眼那一档：**它本来就是「眼睛闭上」这一件事**，没必要再发明一个。 */
function wince(node: HTMLButtonElement | null | undefined): void {
  if (node === null || node === undefined) return
  node.classList.add("pet--blink")
  setTimeout(() => {
    node.classList.remove("pet--blink")
  }, WINCE_MS)
}

/**
 * 挨了一下的那三帧：**顺着挨打的方向压，再反弹回来**。
 *
 * 从天上砸下来是压扁（矮胖），横着挨一记是压瘦（细高）——同一个形演两种撞击，
 * 撞击就没了方向；而方向恰恰是「刚才发生了什么」的全部内容。
 */
function squash(k: number, axis: Hit["axis"]): Keyframe[] {
  const hit = axis === "y" ? [1 + k, 1 - k] : [1 - k, 1 + k]
  const back = axis === "y" ? [1 - k * 0.4, 1 + k * 0.4] : [1 + k * 0.4, 1 - k * 0.4]
  return [
    { transform: `scale(${String(hit[0])}, ${String(hit[1])})` },
    { transform: `scale(${String(back[0])}, ${String(back[1])})`, offset: 0.45 },
    { transform: "scale(1, 1)" },
  ]
}
export function Pets({
  engines,
  engine,
  running,
}: {
  /** 注册了哪几家。**由宿主给**，不在这里写死。 */
  engines: readonly EngineInfo[]
  /** 这个会话现在归谁跑。只有它是亮的——「谁在答」一眼看得出，不用再挂一枚徽章。 */
  engine: EngineId
  /** 这一轮正在跑。只有这时候当前那只才跳。 */
  running: boolean
}): React.JSX.Element | null {
  const shown = useMemo(() => pick(engines, engine), [engines, engine])
  const count = shown.length
  const gaits = useMemo(() => shown.map((e) => gaitOf(lookOf(e.id).shape)), [shown])
  const bodies = useRef<(HTMLSpanElement | null)[]>([])
  const reduced = useReduced()
  // 砸到地上要有分量：**按落地速度定砸扁的深浅**，轻轻放下几乎看不出，
  // 从对话框顶上摔下来会实实在在瘪一下
  // 砸到地、撞到墙、撞到同伴走的都是这一下（判据在 `hitOf`）：
  // **在眼睛看来它们是同一件事——挨了一下**，区别只在朝哪个方向挨的
  const onHit = useCallback(
    (index: number, hit: Hit) => {
      if (reduced) return
      const k = Math.min(0.3, hit.speed / 2600)
      bodies.current[index]?.animate(squash(k, hit.axis), { duration: 300, easing: "ease-out" })
      if (hit.speed >= WINCE_AT) wince(ctl.nodes.current[index])
      // 砸得够重时，旁边站着的会被**震一下**。物理上不成立（它们又没连在一起），
      // 但这是整套里最便宜的一处「它们在同一个世界里」——而那正是想要的
      if (hit.speed < JOLT_AT) return
      for (const [j, body] of bodies.current.entries()) {
        if (j !== index) body?.animate(JOLT, { duration: 260, easing: "ease-out" })
      }
    },
    [reduced],
  )
  const ctl = usePets(count, gaits, onHit)
  // **只给待在窝里、又不是正在跑的那几只排班**——理由在 `usePetMood` 开头
  useMood(ctl.nodes, ctl.pets, count, reduced)
  const drag = usePetDrag(ctl, bodies, reduced)

  if (count === 0) return null

  return (
    <div className="pets" ref={ctl.area} aria-hidden="true">
      {/* 影子和身体是**分开的两组**：影子钉在地面上不跟着抬，那是「它离地多高」
          唯一的说法（见 petPaint.ts）。摆在前面，所以永远压在身体下面 */}
      {shown.map((info) => (
        <span
          key={`shade-${info.id}`}
          className="pet__shade"
          ref={(n) => {
            ctl.shades.current[shown.indexOf(info)] = n
          }}
        />
      ))}
      {shown.map((info, i) => (
        <button
          key={info.id}
          type="button"
          ref={(n) => {
            ctl.nodes.current[i] = n
          }}
          className={classOf(info.id === engine, running, lookOf(info.id))}
          title={titleOf(info.label, info.id === engine, running)}
          onPointerDown={drag.down(i)}
          onPointerMove={drag.move}
          onPointerUp={drag.up}
          onPointerCancel={drag.up}
        >
          {/* 状态点在**头顶**，不在脚下。挂在脚下时它垫在身子和地面之间，
              三只看起来全都悬空——而它们本来是站在输入框上沿的，那条边就是地面 */}
          {info.id === engine && running ? <span className="pet__dot" /> : null}
          <span
            className="pet__lean"
            ref={(n) => {
              ctl.leans.current[i] = n
            }}
          >
            <span
              className="pet__body"
              ref={(n) => {
                bodies.current[i] = n
              }}
            >
              {lookOf(info.id).shape === "crab" ? <Crab /> : <Slime />}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** 眨眼、瞟眼、被捏着、走路那几个类**不在这儿**——它们每秒都可能变，
    由 `useMood` / `usePetDrag` / `petPaint` 直接写 `classList`，不换一次重渲染。 */
function classOf(on: boolean, running: boolean, look: PetLook): string {
  return [
    "pet",
    `pet--${look.tone}`,
    `pet--${look.shape}`,
    on ? "pet--on" : "",
    on && running ? "pet--run" : "",
  ]
    .filter((c) => c !== "")
    .join(" ")
}

function titleOf(label: string, on: boolean, running: boolean): string {
  if (!on) return label
  return running ? `${label} · 正在跑` : `${label} · 这一轮归它`
}

/**
 * 画哪几只。装了的优先，最多 `MAX` 只，**当前这家一定在里面**——
 * 它被截掉的话，界面上就没有任何地方画着「谁在答」了。
 */
function pick(engines: readonly EngineInfo[], engine: EngineId): readonly EngineInfo[] {
  const usable = engines.filter((e) => e.state !== "missing" || e.id === engine)
  const capped = usable.slice(0, MAX)
  if (capped.some((e) => e.id === engine)) return capped
  const mine = usable.find((e) => e.id === engine)
  return mine === undefined ? capped : [mine, ...capped.slice(0, MAX - 1)]
}

export type { Pet }
