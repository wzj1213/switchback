import { useEffect, useRef } from "react"
import type { BrassMode, TrajMode } from "../../shared/settings.js"
import { createFx, resetFx, stepFx } from "../pet-fx.js"
import { createFoeArt } from "../pet-foe-art.js"
import { drawFx, readPalette, type Palette } from "../pet-fx-draw.js"
import type { Flow } from "../useFlow.js"
import { SIZE, type Pet, type PetShape } from "../pets.js"

/**
 * 开火那一层的画布。**桌宠本体一无所知**——它和这张 canvas 之间只有一个接口：
 * `pets` 里那只的坐标（见 `pet-fx.ts` 开头）。
 *
 * ## 为什么这一层完全不走 React
 *
 * 它每秒要动六十次，而每次要动的只有一张 canvas 的内容。走 state 的话
 * 就是一秒六十次重渲染，把整棵子树的 diff 拉进热路径。
 *
 * ## 闲下来是**真的停**，不是「跑着但不画」
 *
 * 上一版把 `requestAnimationFrame` 写在帧函数的第一行，于是那条循环一旦起来
 * 就再也停不下来：没有输出、没有怪、枪也收着的时候，它照样每秒醒六十次去推进
 * 一个空世界。一个天天开着的窗口这样烧一整天，那是「到处卡」里实打实的一份。
 *
 * 现在分两档：**有东西在动就 rAF，全静下来就退到 120ms 一次的慢拍**。
 * 慢拍仍然推进世界（静默计时、刷怪节拍都靠它），只是不再和屏幕刷新率绑在一起；
 * 一有东西动起来立刻切回 rAF。代价是「开始吐字」到「第一发打出去」最多晚 120ms，
 * 而抽枪那一下本来就要小半秒。
 */
export function PetFx(props: FxProps): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const live = useRef(props)
  live.current = props
  const { pets, flow } = props

  useEffect(() => {
    const node = canvas.current
    const g = node?.getContext("2d") ?? null
    if (node === null || g === null) return undefined
    const box: Box = { w: 0, h: 0, dpr: 1 }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      // 尺寸没真变就什么都不做；真变了就等于**画布刚被清空**，得补一帧
      if (rect === undefined || !fit(node, box, rect)) return
      clock.drew = true
      if (clock.slow !== 0) {
        clearTimeout(clock.slow)
        clock.slow = 0
        clock.raf = requestAnimationFrame(frame)
      }
    })
    observer.observe(node)

    const world = createFx()
    const art = createFoeArt()
    const clock = { last: performance.now(), raf: 0, slow: 0, drew: true, bitten: 0 }
    // 换会话就把这一层整个清掉。**放在帧里认而不是进 effect 依赖**——
    // 进依赖的话每换一条会话都要重订 ResizeObserver、重挂主题监听，
    // 而要清的只是世界本身
    let seen = live.current.threadId
    const paint = { pal: undefined as Palette | undefined, tone: "", gen: 0 }

    const frame = (now: number): void => {
      const dt = (now - clock.last) / 1000
      clock.last = now
      const props2 = live.current
      if (props2.threadId !== seen) {
        seen = props2.threadId
        resetFx(world)
        clock.bitten = 0
        clock.drew = true
      }
      const pet = props2.pets.current[props2.index]
      const flow = props2.flow()
      const rate = flow.rate
      // 台面：靶钉在这上面。**量不准就整帧不推进**——`homeAt` 那时给 undefined，
      // 硬摆的话靶会钉到画布外面去（同 `pet-seats.ts` 里 `measured` 那条）
      const home = props2.homeAt(props2.index)
      if (pet !== undefined && home !== undefined && box.w >= 2) {
        stepFx(world, dt, {
          pet,
          shape: props2.shape,
          rate,
          busyHands: props2.busyHands,
          running: props2.running,
          ratio: props2.ratio,
          left: -20,
          field: { homeX: home.x, ground: home.y + SIZE },
          bench: flow.last,
          foes: props2.foes,
          brass: props2.brass,
          traj: props2.traj,
          range: props2.range,
          rand: Math.random,
        })
        if (world.bites > clock.bitten) {
          clock.bitten = world.bites
          props2.onBite()
        }
        // 闲着整帧不画，但「忙→闲」那一帧要画一次收尾，否则最后一颗子弹会留在画面上
        if (world.moving || clock.drew) {
          clock.drew = world.moving
          if (paint.pal === undefined || paint.tone !== props2.tone) {
            paint.pal = readPalette(document.documentElement, props2.tone)
            paint.tone = props2.tone
            paint.gen += 1
          }
          g.setTransform(box.dpr, 0, 0, box.dpr, 0, 0)
          g.clearRect(0, 0, box.w, box.h)
          drawFx(g, world, paint.pal, { art, gen: paint.gen, range: props2.range })
        }
      }
      schedule(world.moving || rate > 1)
    }

    /** 有东西在动就跟着刷新率，全静下来就退到慢拍。**两条路只留一个句柄。** */
    const schedule = (awake: boolean): void => {
      if (awake) clock.raf = requestAnimationFrame(frame)
      else clock.slow = window.setTimeout(() => frame(performance.now()), IDLE_MS)
    }
    clock.raf = requestAnimationFrame(frame)

    // 换主题要重读颜色。**监听而不是每帧查**：它一天变不了两次
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const repaint = (): void => {
      paint.pal = undefined
    }
    media.addEventListener("change", repaint)

    return () => {
      cancelAnimationFrame(clock.raf)
      clearTimeout(clock.slow)
      observer.disconnect()
      media.removeEventListener("change", repaint)
    }
  }, [pets, flow])

  return <canvas className="pets__fx" ref={canvas} aria-hidden="true" />
}

interface Box {
  w: number
  h: number
  dpr: number
}

/**
 * 把画布的像素尺寸对齐到它的 CSS 尺寸。**返回「这一下真的改了」。**
 *
 * ## 为什么「改没改」这件事必须答出来
 *
 * 给 canvas 写 `width` / `height` 会把画布**整个清空**——哪怕写进去的是同一个数。
 * 而 `ResizeObserver` 在每次布局里都可能响一声，所以无条件写等于随机清屏。
 *
 * 更要命的是这一层闲下来是「真的停」（见组件抬头）：没东西在动时整帧跳过绘制，
 * 靠画布自己留着上一帧。清空之后**没有任何一帧会来重画**。
 *
 * 实测长这样：打开一条还没继续的会话，靶子好好地立在那儿；点一下「继续」，
 * 输入区变高、活动区跟着变，靶子当场消失，而且再也不回来——看起来像
 * 「一开始对话靶子就没了」，其实和对话没有半点关系，是画布被清空了没人补。
 */
function fit(node: HTMLCanvasElement, box: Box, rect: DOMRectReadOnly): boolean {
  const dpr = Math.min(2, window.devicePixelRatio)
  const w = Math.round(rect.width * dpr)
  const h = Math.round(rect.height * dpr)
  box.dpr = dpr
  box.w = rect.width
  box.h = rect.height
  if (node.width === w && node.height === h) return false
  node.width = w
  node.height = h
  return true
}

/** 慢拍的间隔。见组件抬头那段。 */
const IDLE_MS = 120

interface FxProps {
  /** 桌宠本体的物理状态。**只读**——这一层从不改它。 */
  pets: React.RefObject<Pet[]>
  /** 当前那只在 `pets` 里的下标。 */
  index: number
  /**
   * 那只的**窝**在哪。**靶钉在这上面，不钉在它身上**——见 `pet-range.ts` 开头。
   * 每帧现取而不是当 prop 传一个算好的坐标：窝会随窗口宽度和引擎列表变，
   * 而这一层不走 React，收不到重渲染。
   */
  homeAt: (index: number) => { x: number; y: number } | undefined
  /** 哪条会话。**一变就把这一层清空**——上一条的怪、纸带、弹壳、靶都不属于这一条。 */
  threadId: string
  /** 当前引擎的配色名（`kimi` / `claude` / …）。弹丸用它：**弹是那家打出去的**。 */
  tone: string
  /** 当前桌宠轮廓。只用于把枪托接到真实的手/横臂上。 */
  shape: PetShape
  /** 取此刻的流速与上一轮的成绩。见 `useFlow`。 */
  flow: () => Flow
  /** 手里要不要换别的东西（在跑工具、在等审批）。 */
  busyHands: boolean
  /** 这一轮在不在跑。不跑的时候没有压力可言——它只是在等你说话。 */
  running: boolean
  /** 上下文用了多满（0~1）。引擎没报窗口时给 0。**这一层不知道它从哪儿来。** */
  ratio: number
  /** 让不让压力显形（左边爬过来的那些）。 */
  foes: boolean
  /** 弹壳归谁。 */
  brass: BrassMode
  /** 弹丸打到哪儿去。 */
  traj: TrajMode
  /** 打靶。 */
  range: boolean
  /**
   * 被摸到脸上了。**回调而不是让这一层去改桌宠**：那只的身体归 `Pets` 管，
   * 挨了一下该怎么演已经有一套现成的（`pet-hit-fx.ts`）。
   */
  onBite: () => void
}
