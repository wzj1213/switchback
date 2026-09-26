import { useEffect, useState } from "react"
import type { Notice } from "@omni/store"

type NoticeTone = "danger" | "warning" | "info"

function toneOf(notice: Notice): NoticeTone {
  if (notice.kind === "notification") {
    if (notice.color === "error") return "danger"
    return notice.priority === "high" || notice.priority === "immediate" ? "warning" : "info"
  }
  return notice.kind === "crashed" || notice.kind === "egress" ? "danger" : "warning"
}

/** 平时摆最新那条；有没关掉的「批量外发」就一直是它（理由同桌面端）。 */
function shownOf(notices: readonly Notice[]): Notice | undefined {
  return notices.findLast((notice) => notice.kind === "egress") ?? notices.at(-1)
}

function labelOf(notice: Notice): string {
  if (notice.kind === "crashed") return "出错了"
  if (notice.kind === "degraded") return "能力受限"
  // 登录只能在那台 Mac 上办（它会开浏览器或终端），这里只照实说
  if (notice.kind === "auth") return "需要登录"
  if (notice.kind === "egress") return "批量外发"
  return "引擎提示"
}

/**
 * 出事了要让人看见。
 *
 * ## 两条完全不同的通道，都要画
 *
 * - **`remote.notice`**：远程那一层自己的话（命令形状不认、被钳、被拒）。
 *   它来自 `ServerFrame` 的 `notice`，一次一条。
 * - **`state.notices`**：**宿主执行命令时的失败**。引擎起不来、`resume` 接不回来、
 *   会话不存在、日志写满降级——全都走 `report()` → `engine.status` → 归约器。
 *
 * 上一版这一端**只画前者**，于是后者一条都到不了手机：你在地铁上点「接回来」，
 * 宿主那边报「这个会话没有留下引擎侧的句柄」——那句话写得很清楚，
 * **而它只出现在 Mac 的屏幕上，你人不在那儿**。手机上不报错、不变色、不弹条。
 *
 * 桌面端一直画着（`renderer` 的 `Notices`）。两端的差别不该是「谁看得见错误」。
 *
 * ## 为什么按 id 记「关掉过」
 *
 * `notices` 是归约出来的状态，不是一次性事件——不记的话关掉一条，
 * 下一帧它又回来了。
 */
export function Notices({
  notices,
  wire,
  onDismissWire,
}: {
  /** 宿主那侧的失败（归约来的）。 */
  notices: readonly Notice[]
  /** 远程那一层的话（一次一条）。 */
  wire: string | undefined
  onDismissWire: () => void
}): React.JSX.Element | null {
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  // 只画最新那条：小屏上堆三条横幅等于把正文挤没了，而人要看的是最近发生的事
  const latest = shownOf(notices.filter((n) => !gone.has(n.id)))
  useEffect(() => {
    if (latest?.kind !== "notification" || latest.timeoutMs === undefined) return
    const timer = setTimeout(() => {
      setGone((prev) => new Set(prev).add(latest.id))
    // 以本端收到事件的时刻起算；手机与宿主的系统时钟不一定一致。
    }, latest.timeoutMs)
    return () => clearTimeout(timer)
  }, [latest])

  if (wire === undefined && latest === undefined) return null

  return (
    <>
      {wire === undefined ? null : (
        <div className="notice" role="alert">
          <span className="notice__text">{wire}</span>
          <button className="btn btn--ghost" type="button" onClick={onDismissWire} aria-label="知道了">
            ✕
          </button>
        </div>
      )}
      {latest === undefined ? null : (
        <div
          className="notice"
          role={toneOf(latest) === "info" ? "status" : "alert"}
          data-kind={latest.kind}
          data-tone={toneOf(latest)}
        >
          {/* 抬头照 `kind` 写：`degraded` 是「引擎好好的、只是掉了能力」，
              顶着「引擎故障」端出去会把排查引到错的方向 */}
          {/* 同一件事接连报了几次，store 里已经合成一条；这里照实带上次数 */}
          <span className="notice__kind">
            {(latest.count ?? 1) > 1 ? `${labelOf(latest)} ×${String(latest.count)}` : labelOf(latest)}
          </span>
          <span className="notice__text">{latest.text}</span>
          <button
            className="btn btn--ghost"
            type="button"
            aria-label="知道了"
            onClick={() => {
              setGone((prev) => new Set(prev).add(latest.id))
            }}
          >
            ✕
          </button>
        </div>
      )}
    </>
  )
}
