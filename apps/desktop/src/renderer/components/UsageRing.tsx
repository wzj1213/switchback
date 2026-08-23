import type { UsageLevel } from "../usage.js"

/**
 * 上下文进度环：模型选择器触发器上那枚图标。
 *
 * 它替掉的是一枚静态火花——同一个位置从此回答「这轮带了多少上去」。
 * 平时是中性灰，逼近窗口上限才变色（同顶栏 meter 的档位）：
 * 一直是彩色的话，真到危险区就没有升级空间了。
 *
 * **只给有分母的会话画**：`contextWindow` 缺席时调用方保留原来的图标——
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
