import type { Usage } from "@omni/protocol"
import { meterOf } from "../usage.js"

/**
 * 上下文用量表。
 *
 * 生产环境里这不是装饰：会话越长，每次请求带上去的历史越多，撞上窗口上限时
 * 模型会开始压缩历史、行为明显变差。**用户需要在撞上之前看见它逼近**，
 * 而不是事后猜「刚才它怎么突然变笨了」。
 */
export function ContextMeter({ usage }: { usage: Usage | undefined }): React.JSX.Element | null {
  const meter = meterOf(usage)
  if (meter === undefined) return null
  return (
    <span className={`meter meter--${meter.level}`} title={meter.title}>
      {meter.ratio === undefined ? null : (
        <span className="meter__track" aria-hidden="true">
          <span className="meter__fill" style={{ width: `${String(meter.ratio * 100)}%` }} />
        </span>
      )}
      <span className="meter__label">{meter.label}</span>
      {meter.total === undefined ? null : <span className="meter__total">{meter.total}</span>}
    </span>
  )
}
