import { useState } from "react"
import type { ActivityDay, ActivityMetric } from "../../shared/activity.js"
import { bigNumber, dayText, gridOf, metricOf, type HeatCell, type HeatMode } from "../activity-view.js"
import { Segmented } from "./SettingsBits.js"
import type { Locale } from "@switchback/i18n"
import { useLocale } from "../i18n.js"
import { ACTIVITY_HEAT } from "./ActivityHeat.messages.js"

type Text = (typeof ACTIVITY_HEAT)[Locale]

/**
 * 一年（或者你用了多久）的活动热力图。
 *
 * ## 两个开关，各管一件事
 *
 * **看哪一项**（轮次 / 消息 / 工具 / token）和**怎么算**（每日 / 每周 / 累计）是两个正交的问题。
 * 挤成一个开关就得摆出十二个组合，而它们里面只有四个有人会用。
 *
 * ## 为什么默认不是 token
 *
 * token 的口径**各家不是一回事**（见 `shared/activity.ts` 的 `tokensByEngine`）：
 * 同样一条长会话，一家报几百万，另一家能报出三个数量级更大的数。
 * 轮次是 Switchback 自己数的，跨引擎可比——所以它是默认，token 是可选。
 *
 * ## 悬停读数摆在标题行，不做浮动 tooltip
 *
 * 浮动层要算位置、要处理贴边、要在滚动时跟随，而它说的话固定只有一行。
 * 摆在固定的位置上反而更好读：眼睛不用追着指针跑。
 */

const METRICS: readonly ActivityMetric[] = ["turns", "asks", "tools", "tokens"]

const MODES: readonly HeatMode[] = ["daily", "weekly", "total"]


const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const

/**
 * 深浅那一档的类名。
 *
 * **查表而不是 `--l${level}` 拼**：样式守卫认的是「组件里写死的类名」，
 * 而拼出来的那一半（`heat__cell--l`）是个前缀不是类名——它会被当成一个
 * 没有任何规则的类报出来。查表让整个类名都是写死的那一段。
 */
const LEVEL = ["l0", "l1", "l2", "l3", "l4"] as const

export function ActivityHeat({ days, now }: {
  days: readonly ActivityDay[]
  /** 今天是哪天。**由调用方给**，这样几何是纯的、测得动。 */
  now: number
}): React.JSX.Element {
  const [metric, setMetric] = useState<ActivityMetric>("turns")
  const [mode, setMode] = useState<HeatMode>("daily")
  const [hover, setHover] = useState<string | undefined>(undefined)
  const locale = useLocale()
  const m = ACTIVITY_HEAT[locale]
  const grid = gridOf(days, { metric, mode, now, locale })
  const cells = grid.weeks.flat()
  const shown = cells.find((cell) => cell.date === hover)

  return (
    <section className="heat">
      <div className="heat__head">
        <h3 className="set__title heat__title">{m.title}</h3>
        <span className="heat__readout">
          {shown === undefined ? m.hint[mode] : readoutOf(shown, metric, mode, locale)}
        </span>
        <Segmented options={METRICS.map((id) => ({ id, label: m.metric[id] }))} value={metric} onPick={setMetric} />
        <Segmented options={MODES.map((id) => ({ id, label: m.mode[id] }))} value={mode} onPick={setMode} />
      </div>
      <div className="heat__scroll">
        <div className="heat__months" style={{ gridTemplateColumns: `repeat(${String(grid.weeks.length)}, var(--heat-cell))` }}>
          {grid.months.map((month) => (
            <span key={month.label} className="heat__month" style={{ gridColumnStart: month.week + 1 }}>
              {month.label}
            </span>
          ))}
        </div>
        <div className="heat__body">
          <div className="heat__days">
            {WEEKDAYS.map((index) => (
              <span key={index} className="heat__weekday">{m.weekday(index)}</span>
            ))}
          </div>
          {/* 一列一周、周一在上：交给 `grid-auto-flow: column` 按顺序填，
              比每一格自己算「第几列第几行」少一整套下标算术 */}
          <div
            className="heat__grid"
            onMouseLeave={() => {
              setHover(undefined)
            }}
          >
            {cells.map((cell) => (
              <span
                key={cell.date}
                className={`heat__cell heat__cell--${LEVEL[cell.level]}`}
                title={readoutOf(cell, metric, mode, locale)}
                onMouseEnter={() => {
                  setHover(cell.date)
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="heat__legend">
        <span>{m.less}</span>
        {LEVEL.map((level) => (
          <span key={level} className={`heat__cell heat__cell--${level}`} aria-hidden="true" />
        ))}
        <span>{m.more}</span>
      </div>
    </section>
  )
}

function readoutOf(cell: HeatCell, metric: ActivityMetric, mode: HeatMode, locale: Locale): string {
  const m = ACTIVITY_HEAT[locale]
  const { date, value, day } = cell
  const scope = m.scope[mode]
  const head = `${dayText(date, locale)}${scope === "" ? "" : ` · ${scope}`}`
  if (value === 0 && day === undefined) return `${head} · ${m.idle}`
  const main = `${bigNumber(value, locale)} ${m.unit(metric, value)}`
  if (mode !== "daily" || day === undefined) return `${head} · ${main}`
  // 每日口径下顺带把当天别的几项也说出来：一格只画一个数，但人想知道的是那天在干嘛
  return m.withDetail(head, main, detailOf(day, metric, m, locale))
}

function detailOf(day: ActivityDay, metric: ActivityMetric, m: Text, locale: Locale): string {
  return METRICS.filter((id) => id !== metric && metricOf(day, id) > 0)
    .map((id) => `${m.metric[id]} ${bigNumber(metricOf(day, id), locale)}`)
    .join(" · ") || m.nothingElse
}
