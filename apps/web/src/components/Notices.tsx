import { useState } from "react"
import type { Notice } from "@omni/store"

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
  const latest = notices.filter((n) => !gone.has(n.id)).at(-1)

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
        <div className="notice" role="alert" data-kind={latest.kind}>
          {/* 抬头照 `kind` 写：`degraded` 是「引擎好好的、只是掉了能力」，
              顶着「引擎故障」端出去会把排查引到错的方向 */}
          <span className="notice__kind">{latest.kind === "crashed" ? "出错了" : "能力受限"}</span>
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
