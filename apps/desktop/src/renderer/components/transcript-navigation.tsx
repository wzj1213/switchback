import { memo, useRef } from "react"
import type { EngineInfo } from "@switchback/protocol"
import type { NavPoint } from "../transcript-rail.js"
import { useTranscriptRail } from "../use-transcript-rail.js"
import { TranscriptRail } from "./TranscriptRail.js"

/** 滚动只更新大纲，不让整段历史跟着每一帧重新遍历。 */
export const TranscriptNavigation = memo(function TranscriptNavigation({ scroller, inner, points, engines }: {
  scroller: React.RefObject<HTMLElement | null>
  inner: React.RefObject<HTMLElement | null>
  points: readonly NavPoint[]
  engines: readonly EngineInfo[]
}): React.JSX.Element {
  const nav = useRef<HTMLElement>(null)
  const rail = useTranscriptRail(scroller, inner, points, nav)
  return <TranscriptRail navRef={nav} marks={rail.marks} activeId={rail.activeId} engines={engines} onJump={rail.jump} />
})
