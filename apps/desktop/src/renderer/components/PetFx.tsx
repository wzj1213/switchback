import { useEffect, useRef } from "react"
import type { EngineId } from "@omni/protocol"
import { createFx, stepFx } from "../pet-fx.js"
import { drawFx, readPalette, type Palette } from "../pet-fx-draw.js"
import { lookOf, type Pet } from "../pets.js"
import type { PetSlot } from "../pet-roster.js"
import { useFlow } from "../useFlow.js"

/**
 * 开火那一层的画布。**桌宠本体一无所知**——它和这张 canvas 之间只有一个接口：
 * `pets` 里那只的坐标（见 `pet-fx.ts` 开头）。
 *
 * ## 为什么这一层完全不走 React
 *
 * 它每秒要动六十次，而每次要动的只有一张 canvas 的内容。走 state 的话
 * 就是一秒六十次重渲染，把整棵子树的 diff 拉进热路径——
 * 而这棵子树在这六十帧里**一个节点都没变**。
 *
 * ## 三处省下来的开销
 *
 * - **尺寸由 `ResizeObserver` 写，不在帧里量。** 每帧 `getBoundingClientRect`
 *   是一次强制同步布局，而这张画布的大小只在窗口变化时才变。
 * - **闲着整帧不画。** canvas 会保留上一帧，而这一帧本来就该和上一帧一样，
 *   所以跳过是无损的——只在「忙→闲」那一帧多画一次收尾。
 * - **调色板按主题读一次。** `getComputedStyle` 也是一次强制样式计算，
 *   而这里的六七种颜色只在换主题、换引擎时变。
 */
export function PetFx({
  pets,
  index,
  tone,
  flow,
  busyHands,
  running,
  ratio,
  foes,
  onBite,
}: {
  /** 桌宠本体的物理状态。**只读**——这一层从不改它。 */
  pets: React.RefObject<Pet[]>
  /** 当前那只在 `pets` 里的下标。 */
  index: number
  /** 当前引擎的配色名（`kimi` / `claude` / …）。弹丸用它：**弹是那家打出去的**。 */
  tone: string
  /** 取此刻的流速。见 `useFlow`。 */
  flow: () => number
  /** 手里要不要换别的东西（在跑工具、在等审批）。 */
  busyHands: boolean
  /** 这一轮在不在跑。不跑的时候没有压力可言——它只是在等你说话。 */
  running: boolean
  /** 上下文用了多满（0~1）。引擎没报窗口时给 0。**这一层不知道它从哪儿来。** */
  ratio: number
  /** 让不让压力显形（左边爬过来的那些）。 */
  foes: boolean
  /**
   * 被摸到脸上了。
   *
   * **回调而不是让这一层去改桌宠**：那只的身体归 `Pets` 管，
   * 挨了一下该怎么演也已经有一套现成的（`pet-hit-fx.ts`）。
   * 这里只负责说「挨了」，怎么演不归它。
   */
  onBite: () => void
}): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const live = useRef({ index, tone, busyHands, running, ratio, foes, onBite })
  live.current = { index, tone, busyHands, running, ratio, foes, onBite }

  useEffect(() => {
    const node = canvas.current
    if (node === null) return undefined
    const g = node.getContext("2d")
    if (g === null) return undefined

    const box = { w: 0, h: 0, dpr: 1 }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect === undefined) return
      box.dpr = Math.min(2, window.devicePixelRatio)
      box.w = rect.width
      box.h = rect.height
      node.width = Math.round(rect.width * box.dpr)
      node.height = Math.round(rect.height * box.dpr)
    })
    observer.observe(node)

    const world = createFx()
    let bitten = 0
    let palette: Palette | undefined
    let paintedTone = ""
    let last = performance.now()
    let drewLast = true
    let raf = 0

    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame)
      const dt = (now - last) / 1000
      last = now
      const pet = pets.current[live.current.index]
      if (pet === undefined || box.w < 2) return
      stepFx(world, dt, {
        pet,
        rate: flow(),
        busyHands: live.current.busyHands,
        running: live.current.running,
        ratio: live.current.ratio,
        left: -20,
        foes: live.current.foes,
        rand: Math.random,
      })
      if (world.bites > bitten) {
        bitten = world.bites
        live.current.onBite()
      }
      // 闲着整帧不画，但「忙→闲」那一帧要画一次收尾，否则最后一颗子弹会留在画面上
      if (!world.moving && !drewLast) return
      drewLast = world.moving
      if (palette === undefined || paintedTone !== live.current.tone) {
        palette = readPalette(document.documentElement, live.current.tone)
        paintedTone = live.current.tone
      }
      g.setTransform(box.dpr, 0, 0, box.dpr, 0, 0)
      g.clearRect(0, 0, box.w, box.h)
      drawFx(g, world, palette)
    }
    raf = requestAnimationFrame(frame)

    // 换主题要重读颜色。**监听而不是每帧查**：它一天变不了两次
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const repaint = (): void => {
      palette = undefined
    }
    media.addEventListener("change", repaint)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      media.removeEventListener("change", repaint)
    }
  }, [pets, flow])

  return <canvas className="pets__fx" ref={canvas} aria-hidden="true" />
}

export interface FireProps {
  /** 要不要开火。 */
  on: boolean
  /** 哪条会话。流速只算这一条的——理由见 `flow-scope.ts`。 */
  threadId: string
  /** 这一轮在不在跑。不跑的时候没有压力可言——它只是在等你说话。 */
  running: boolean
  /** 手里有别的东西（在等审批）：这时枪立刻收起来。 */
  handsBusy: boolean
  /** 上下文用了多满（0~1）。上下文快满时会来胖子。 */
  ctxRatio: number
  /** 让不让压力显形（左边爬过来的那些）。 */
  foes: boolean
}

export function FireLayer({
  pets,
  slots,
  engine,
  fire,
  reduced,
  onBite,
}: {
  pets: React.RefObject<Pet[]>
  slots: readonly PetSlot[]
  engine: EngineId
  fire: FireProps
  reduced: boolean
  onBite: () => void
}): React.JSX.Element | null {
  const flow = useFlow(fire.threadId)
  const mine = slots.findIndex((slot) => slot.engine === engine)
  if (!fire.on || reduced || mine < 0) return null
  return (
    <PetFx
      pets={pets}
      index={mine}
      tone={lookOf(engine).tone}
      flow={flow}
      busyHands={fire.handsBusy}
      running={fire.running}
      ratio={fire.ctxRatio}
      foes={fire.foes}
      onBite={onBite}
    />
  )
}
