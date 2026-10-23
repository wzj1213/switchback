import { useCallback, useEffect, useRef, useState } from "react"
import type { EngineInfo, Thread } from "@switchback/protocol"
import type { Locale } from "@switchback/i18n"
import { rowLabelOf, type SidebarRow } from "../sidebar.js"
import { dayOf, sinceOf } from "../status.js"
import { labelOf } from "./Composer.js"
import { trustsOf } from "../trusts.js"
import { effortLabel } from "./ModelPicker.js"
import { displayStatus } from "@switchback/store"
import { useLocale } from "../i18n.js"
import { ROW_PEEK } from "./RowPeek.messages.js"

/**
 * 侧栏行的悬停卡：完整路径、引擎、状态原文——只读预览。
 *
 * 规矩（每条都有出处）：
 * - **卡里一个可点的东西都不放**：hover 只是预览，真入口是点行本身。
 *   `pointer-events: none`，鼠标穿过去，正下面的行照样接管。
 * - **300ms 意图延迟**，扫过不弹；Tab 到行上走同一颗定时器。
 * - **拖动中不弹**：浮层不占位（不会取消拖拽），但会盖住落点高亮。
 * - **滚动/缩放即收**：fixed 定位不会跟着滚动区走，留着就是指着一条已经挪走的行。
 *
 * 数据全在 `Thread` 上，一行新字段都不加。**最后一条消息不进来**——
 * 侧栏这层只有 `preview`（第一条用户消息），为一次 hover 读盘不值。
 */

/** 悬停卡的锚点（fixed 坐标）。 */
export interface PeekSpot {
  x: number
  y: number
}

const DELAY = 300

export function usePeek(disabled: boolean): {
  spot: PeekSpot | undefined
  arm: (el: HTMLElement) => void
  disarm: () => void
} {
  const [spot, setSpot] = useState<PeekSpot | undefined>(undefined)
  const timer = useRef(0)
  const events = useRef<AbortController | undefined>(undefined)

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = 0
    events.current?.abort()
    events.current = undefined
  }, [])
  const disarm = useCallback(() => {
    cancel()
    setSpot(undefined)
  }, [cancel])

  const arm = useCallback(
    (el: HTMLElement) => {
      disarm()
      if (disabled) return
      events.current = new AbortController()
      const { signal } = events.current
      // 从等待弹出开始就能取消；只给当前悬停行注册，避免每条会话常驻监听。
      window.addEventListener("scroll", disarm, { capture: true, signal })
      window.addEventListener("resize", disarm, { signal })
      window.addEventListener("blur", disarm, { signal })
      timer.current = window.setTimeout(() => {
        timer.current = 0
        const rect = el.getBoundingClientRect()
        // 卡高按 ~180 估：宁可往上收，也不探出窗口下沿
        setSpot({ x: rect.right + 10, y: Math.min(rect.top - 8, window.innerHeight - 188) })
      }, DELAY)
    },
    [disabled, disarm],
  )

  // 改名或拖动时收起，避免盖住当前操作。
  useEffect(() => {
    if (disabled) disarm()
  }, [disabled, disarm])

  // 翻页或筛选会卸载行，不能留下等待中的计时器和窗口监听。
  useEffect(() => cancel, [cancel])

  return { spot, arm, disarm }
}

/** 状态那一行：只有「停下来了」才值得说；idle 的行没有这一行。 */
function statusLine(thread: Thread, locale: Locale): { text: string; tone: "warn" | "fail" | "" } | undefined {
  const m = ROW_PEEK[locale]
  const ago = sinceOf(thread.updatedAt, Date.now(), locale)
  switch (displayStatus(thread)) {
    case "waiting_approval":
      return { text: m.waiting(ago), tone: "warn" }
    case "failed":
      return { text: m.failed(ago), tone: "fail" }
    case "running":
      return { text: m.running, tone: "" }
    case "starting":
      return { text: m.starting, tone: "" }
    default:
      return undefined
  }
}

export function RowPeek({
  row,
  engines,
  spot,
}: {
  row: SidebarRow
  engines: readonly EngineInfo[]
  spot: PeekSpot
}): React.JSX.Element {
  const { thread } = row
  const locale = useLocale()
  const m = ROW_PEEK[locale]
  const engine = labelOf(engines, thread.engine)
  const engineRoute = thread.engineProfile === undefined ? engine : `${engine} · ${thread.engineProfile}`
  const model = thread.model ?? m.defaultModel
  const withEffort = thread.effort === undefined ? model : `${model} · ${effortLabel(thread.effort).label}`
  const status = statusLine(thread, locale)
  const relay =
    thread.engineHistory.length > 1
      ? thread.engineHistory.map((e) => labelOf(engines, e)).join(" → ")
      : undefined
  return (
    // aria-hidden：内容和行本身重复，读屏不需要听第二遍
    <span className="peek" style={{ left: spot.x, top: spot.y }} aria-hidden="true">
      <span className="peek__title">{rowLabelOf(row, locale)}</span>
      <span className="peek__path">{thread.cwd}</span>
      <span className="peek__meta">
        {engineRoute} · {withEffort} · {labelOf(trustsOf(locale), thread.trust)}
      </span>
      {status === undefined ? null : (
        <span className={`peek__status${status.tone === "" ? "" : ` peek__status--${status.tone}`}`}>
          {status.text}
        </span>
      )}
      <span className="peek__foot">
        {relay === undefined ? "" : m.relay(relay)}
        {m.created(dayOf(thread.createdAt, locale))}
      </span>
    </span>
  )
}

/**
 * 行的悬停接线：把「何时弹、何时收」收成一行 hook，行组件只摊 handlers 和 card。
 *
 * 从 `SidebarRows.tsx` 的 `Row` 拆出来有两个原因：那边行数到闸门了；
 * 而且这套接线本身有独立的复杂度预算（五个事件、一颗定时器、三条收起的规矩）。
 */
export function useRowPeek({
  drag,
  disabled,
  row,
  engines,
}: {
  /** 拖动接线：一拖起来就不弹（浮层不占位，但会盖住落点高亮）。 */
  drag: { dragging: string | undefined } | undefined
  /** 改名中等一切「这一行正在干别的」的状态。 */
  disabled: boolean
  row: SidebarRow
  engines: readonly EngineInfo[]
}): {
  /** 只摊到主按钮：操作按钮各自显示提示，不叠加整张会话预览。 */
  handlers: Pick<
    React.HTMLAttributes<HTMLElement>,
    "onMouseEnter" | "onMouseLeave" | "onFocus" | "onBlur" | "onPointerDownCapture"
  >
  card: React.JSX.Element | null
} {
  const { spot, arm, disarm } = usePeek(disabled || drag?.dragging !== undefined)
  if (disabled) return { handlers: {}, card: null }
  return {
    handlers: {
      onMouseEnter: (e) => {
        arm(e.currentTarget.closest<HTMLElement>(".row") ?? e.currentTarget)
      },
      onMouseLeave: disarm,
      /*
       * **只有键盘来的焦点才弹。**
       *
       * 上一版是「拿到焦点就弹」，于是鼠标根本不在侧栏时也会莫名其妙冒出一张卡：
       * 选中一条会话、改名对话框关掉把焦点还回来、列表重排之后浏览器补焦点——
       * 每一次都算「拿到焦点」。这些都不是「我想看看这条是什么」。
       *
       * `:focus-visible` 正是浏览器对「这次焦点该不该给用户看见」的判断，
       * 借它一用：键盘 Tab 过来是真，点一下、程序 `focus()` 是假。
       */
      onFocus: (e) => {
        if (e.currentTarget.matches(":focus-visible"))
          arm(e.currentTarget.closest<HTMLElement>(".row") ?? e.currentTarget)
      },
      onBlur: disarm,
      onPointerDownCapture: disarm,
    },
    card: spot === undefined ? null : <RowPeek row={row} engines={engines} spot={spot} />,
  }
}
