import { useCallback, useRef, useState } from "react"
import type { EngineInfo } from "@switchback/protocol"
import { railPeek, type RailMark } from "../transcript-rail.js"
import { engineTint } from "../engine-mark.js"
import { labelOf } from "./Composer.js"

/**
 * 转录区左缘那条大纲。一格 = **你问的一次**；为什么长成一块波形，见 `transcript-rail.ts`。
 *
 * ## 三处照 crew 那版抄的交互（`internal/webui/static/app.js` 的 minimap）
 *
 * - **热区比看得见的那道线大得多**：画出来的是一道 1.5px 高的短线，
 *   而按钮本身是 24×7 的透明块——1.5px 的目标点不中。
 * - **格与卡之间铺一条隐形的桥**：卡浮在格右边 12px 处，中间那条缝里
 *   一旦 `mouseleave` 触发，卡就闪一下没了。桥把这条缝并进热区。
 * - **卡自己可以停、可以选**：进了卡就不关。它常常是一整句提问，
 *   而人看到想要的那句话第一反应是选中它——卡一碰就消失的话这件事做不成。
 *
 * ## 不抢 Tab
 *
 * 整条只有一个 tab 停靠点（当下那一格），进去之后上下键在格之间走。
 * 三十格如果各是一个停靠点，键盘用户从侧栏走到输入框要按三十次。
 *
 * ## 换过引擎的会话按引擎上色
 *
 * 一条来回切过几家的会话，在转录区里是一条**看不出接缝的长流**。
 * 这条导航本来就是这条会话的缩影，让它按引擎分段染色之后，
 * 「上面那五问是 codex 答的、下面这三问是 Claude 答的」不用往回翻就看得出来。
 *
 * **没换过引擎的会话看不出变化**：整条只有一种颜色时和原来那道中性线
 * 是同一个样子（`engineTint` 给的是低饱和度色，不是招牌色）。
 */
export function TranscriptRail({ marks, activeId, engines, onJump, navRef }: {
  navRef?: React.RefObject<HTMLElement | null>
  marks: readonly RailMark[]
  activeId: string | undefined
  /** 引擎清单：悬停卡要把 id 翻成人话。 */
  engines: readonly EngineInfo[]
  onJump: (id: string) => void
}): React.JSX.Element | null {
  const [hover, setHover] = useState<string | undefined>(undefined)
  // 松开那一下不立刻关：指针正从格挪向卡，中间那几十毫秒不该让它闪
  const timer = useRef(0)
  const hold = useCallback((id: string | undefined) => {
    window.clearTimeout(timer.current)
    if (id !== undefined) {
      setHover(id)
      return
    }
    timer.current = window.setTimeout(() => {
      setHover(undefined)
    }, 90)
  }, [])
  // 整条只有一家时不提引擎——那句话每一格都一样，说了等于没说
  const mixed = new Set(marks.map((mark) => mark.engine)).size > 1
  const shown = marks.find((mark) => mark.id === hover)
  const peek = shown === undefined ? undefined : railPeek(shown.text)
  return (
    <nav className="rail" aria-label="按提问跳转" ref={navRef}>
      {marks.map((mark) => (
        <button
          key={mark.id}
          type="button"
          className="rail__tick"
          data-on={mark.id === activeId}
          style={{ top: mark.y }}
          aria-label={`跳到这一问：${railPeek(mark.text).title}`}
          aria-current={mark.id === activeId ? "true" : undefined}
          tabIndex={mark.id === activeId ? 0 : -1}
          onMouseEnter={() => {
            hold(mark.id)
          }}
          onMouseLeave={() => {
            hold(undefined)
          }}
          onFocus={() => {
            hold(mark.id)
          }}
          onBlur={() => {
            hold(undefined)
          }}
          onClick={() => {
            onJump(mark.id)
          }}
        >
          {/* 看得见的只有这一道线；长短由那一轮的产出定，颜色由那一问归谁跑定 */}
          <i
            className="rail__mark"
            style={
              {
                "--mark-w": `${String(mark.width)}px`,
                ...(mark.engine === undefined ? {} : { "--mark-tint": engineTint(mark.engine) }),
              } as React.CSSProperties
            }
          />
        </button>
      ))}
      {shown === undefined || peek === undefined ? null : (
        <span
          className="rail__peek"
          style={{ top: shown.y }}
          onMouseEnter={() => {
            hold(shown.id)
          }}
          onMouseLeave={() => {
            hold(undefined)
          }}
        >
          <span className="rail__peek-title">{peek.title}</span>
          {peek.body === "" ? null : <span className="rail__peek-body">{peek.body}</span>}
          {/* 换过引擎才写这一行：只有一家时它每格都一样，等于白占一行 */}
          {shown.engine === undefined || !mixed ? null : (
            <span className="rail__peek-engine">
              <i style={{ background: engineTint(shown.engine) }} aria-hidden="true" />
              {labelOf(engines, shown.engine)}
            </span>
          )}
        </span>
      )}
    </nav>
  )
}
