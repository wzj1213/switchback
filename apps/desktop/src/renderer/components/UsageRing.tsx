import type { Usage } from "@switchback/protocol"
import { meterOf, type UsageLevel } from "../usage.js"
import { useLocale } from "../i18n.js"

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
      width="14"
      height="14"
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
 * 接线版。
 *
 * ## 为什么它现在**独占**上下文这件事
 *
 * 顶栏原来还有一份 `ContextMeter`，画的是同一个 `usage`——一根条 + 一个百分比。
 * 同一个数在一屏上画两遍，而两遍的说明还不一样（那边带账单，这边没有）。
 * 留下的是这一枚：**底栏这一排全是「下一次发送的属性」**（由谁跑、什么权限、
 * 哪个模型、多大强度），而「还剩多少上下文」正是同一类事实；顶栏说的是
 * 这条会话**的身份**。
 *
 * 搬过来带两个条件，缺一条就是净损失：
 *
 * 1. **说明改用 `meter.title`。** 那里面有「本会话累计 / 缓存命中」，
 *    原来只活在顶栏那份的 `title` 上；不接过来，删掉顶栏等于把账单一起删了。
 * 2. **没有分母时退成纯文字。** 引擎不报窗口大小时 `meterOf` 给的是
 *    `258k tokens` 且 `ratio` 为空——原来这里直接 `return null`，
 *    而顶栏那份照常显示。只留环的话，这类会话上用量会整个消失。
 *    `meter.label` 两种情形都已经算好（`23%` / `258k tokens`），直接用。
 */
export function UsageBadge({ usage }: { usage: Usage | undefined }): React.JSX.Element | null {
  const meter = meterOf(usage, useLocale())
  if (meter === undefined) return null
  return (
    <span className={`usage usage--${meter.level}`} role="img" aria-label={meter.title}>
      {meter.ratio === undefined ? null : <UsageRing ratio={meter.ratio} level={meter.level} />}
      {/* **数字不是环的重复。** 环只回答「在逼近吗」（形 + 色带），
          而一枚 14px 的弧分不出 23% 和 45%——更要命的是它和 loading 转圈同形。
          见 app-composer.css 里 `.usage-ring__fill` 那段。 */}
      <span className="usage__pct">{meter.label}</span>
      <span className="usage__tip" aria-hidden="true">
        {meter.title}
      </span>
    </span>
  )
}
