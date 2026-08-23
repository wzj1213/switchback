import type { Usage } from "@omni/protocol"
import { meterOf, type UsageLevel } from "../usage.js"

/**
 * 上下文进度环：模型胶囊**旁边**那枚独立指示。
 *
 * 它替掉的是触发器里那枚静态火花——上一版把环塞进触发器，结果悬停全被
 * 模型胶囊吃掉，环自己的说明永远没有出场机会。所以它自成一体：
 * 悬停它（不是模型胶囊）出数字卡。
 *
 * 平时是中性灰，逼近窗口上限才变色（同顶栏 meter 的档位）：
 * 一直是彩色的话，真到危险区就没有升级空间了。
 *
 * **只给有分母的会话画**：`contextWindow` 缺席时整块不出现——
 * 照一个猜出来的分母画出来的比例，比没有比例更糟。
 */
export function UsageRing({ ratio, level }: { ratio: number; level: UsageLevel }): React.JSX.Element {
  // r=5.4 的周长；dashoffset 从顶上开始往后退，像水位一样顺时针涨
  const C = 2 * Math.PI * 5.4
  return (
    <svg
      className={`usage-ring usage-ring--${level}`}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <circle className="usage-ring__track" cx="8" cy="8" r="5.4" />
      <circle
        className="usage-ring__fill"
        cx="8"
        cy="8"
        r="5.4"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - ratio)}
        transform="rotate(-90 8 8)"
      />
    </svg>
  )
}

/**
 * 接线版：没有比例就什么都不渲染（引擎没报窗口大小，或还没开始跑）。
 * 数字卡只做悬停预览——它不是控件，点它不会发生任何事。
 */
export function UsageBadge({ usage }: { usage: Usage | undefined }): React.JSX.Element | null {
  const meter = meterOf(usage)
  if (meter?.ratio === undefined) return null
  return (
    <span className="usage" role="img" aria-label={meter.title}>
      <UsageRing ratio={meter.ratio} level={meter.level} />
      <span className="usage__tip" aria-hidden="true">
        {meter.title}
      </span>
    </span>
  )
}
