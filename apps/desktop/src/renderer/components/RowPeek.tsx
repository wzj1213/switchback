import { useCallback, useEffect, useRef, useState } from "react"
import type { EngineInfo, Thread } from "@omni/protocol"
import { rowLabelOf, type SidebarRow } from "../sidebar.js"
import { sinceOf } from "../status.js"
import { labelOf, TRUSTS } from "./Composer.js"
import { effortLabel } from "./ModelPicker.js"

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

export function usePeek(dragging: boolean): {
  spot: PeekSpot | undefined
  arm: (el: HTMLElement) => void
  disarm: () => void
} {
  const [spot, setSpot] = useState<PeekSpot | undefined>(undefined)
  const timer = useRef(0)

  const disarm = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = 0
    setSpot(undefined)
  }, [])

  const arm = useCallback(
    (el: HTMLElement) => {
      if (dragging) return
      const rect = el.getBoundingClientRect()
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        // 卡高按 ~180 估：宁可往上收，也不探出窗口下沿
        setSpot({ x: rect.right + 10, y: Math.min(rect.top - 8, window.innerHeight - 188) })
      }, DELAY)
    },
    [dragging],
  )

  // 拖起来就收——浮层会盖住落点高亮
  useEffect(() => {
    if (dragging) disarm()
  }, [dragging, disarm])

  // 滚动/缩放即收：fixed 卡不跟滚动区走，留着就是指着一条已经挪走的行
  useEffect(() => {
    if (spot === undefined) return undefined
    window.addEventListener("scroll", disarm, true)
    window.addEventListener("resize", disarm)
    return () => {
      window.removeEventListener("scroll", disarm, true)
      window.removeEventListener("resize", disarm)
    }
  }, [spot, disarm])

  return { spot, arm, disarm }
}

/** 状态那一行：只有「停下来了」才值得说；idle 的行没有这一行。 */
function statusLine(thread: Thread): { text: string; tone: "warn" | "fail" | "" } | undefined {
  const ago = sinceOf(thread.updatedAt, Date.now())
  switch (thread.status) {
    case "waiting_approval":
      return { text: `待批 · 停在 ${ago}`, tone: "warn" }
    case "failed":
      return { text: `失败 · ${ago}`, tone: "fail" }
    case "running":
      return { text: "正在跑", tone: "" }
    case "starting":
      return { text: "启动中", tone: "" }
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
  const engine = labelOf(engines, thread.engine)
  const model = thread.model ?? "默认"
  const withEffort = thread.effort === undefined ? model : `${model} · ${effortLabel(thread.effort).label}`
  const status = statusLine(thread)
  const relay =
    thread.engineHistory.length > 1
      ? thread.engineHistory.map((e) => labelOf(engines, e)).join(" → ")
      : undefined
  const created = new Date(thread.createdAt)
  return (
    // aria-hidden：内容和行本身重复，读屏不需要听第二遍
    <span className="peek" style={{ left: spot.x, top: spot.y }} aria-hidden="true">
      <span className="peek__title">{rowLabelOf(row)}</span>
      <span className="peek__path">{thread.cwd}</span>
      <span className="peek__meta">
        {engine} · {withEffort} · {labelOf(TRUSTS, thread.trust)}
      </span>
      {status === undefined ? null : (
        <span className={`peek__status${status.tone === "" ? "" : ` peek__status--${status.tone}`}`}>
          {status.text}
        </span>
      )}
      <span className="peek__foot">
        {relay === undefined ? "" : `接力 ${relay} · `}创建于 {created.getMonth() + 1} 月{" "}
        {created.getDate()} 日
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
  /** 摊到行外壳上：进入/聚焦布防，离开/失焦/按下即收。 */
  handlers: Pick<
    React.HTMLAttributes<HTMLElement>,
    "onMouseEnter" | "onMouseLeave" | "onFocus" | "onBlur" | "onPointerDownCapture"
  >
  card: React.JSX.Element | null
} {
  const { spot, arm, disarm } = usePeek(drag?.dragging !== undefined)
  if (disabled) return { handlers: {}, card: null }
  return {
    handlers: {
      onMouseEnter: (e) => {
        arm(e.currentTarget)
      },
      onMouseLeave: disarm,
      onFocus: (e) => {
        arm(e.currentTarget)
      },
      onBlur: disarm,
      onPointerDownCapture: disarm,
    },
    card: spot === undefined ? null : <RowPeek row={row} engines={engines} spot={spot} />,
  }
}
