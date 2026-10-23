import type { ActivityDigest, NameTally } from "../../shared/activity.js"
import { bigNumber, dayText } from "../activity-view.js"
import { effortLabel } from "./ModelPicker.js"
import { useLocale, useMessages } from "../i18n.js"
import { ACTIVITY_TALLIES } from "./ActivityTallies.messages.js"
import { Blank } from "./SettingsBits.js"

/**
 * 「活动」那一页下半截：洞察、各家用量、几张排行榜。
 *
 * 从页面主体拆出来是行数闸门逼的，但边界也对：上面那半截回答「多少」，
 * 这半截回答「都花在什么上」。
 */

/** 一张排行榜。条形的长度按**榜首**归一——它回答的是「谁占大头」，不是绝对值。 */
export function TallyCard({ title, hint, rows, empty, format, name = (id) => id }: {
  title: string
  hint?: string
  rows: readonly NameTally[]
  empty: string
  format?: (n: number) => string
  name?: (id: string) => string
}): React.JSX.Element {
  const locale = useLocale()
  const shown = format ?? ((n: number): string => bigNumber(n, locale))
  const top = rows[0]?.count ?? 1
  return (
    <section className="stat-card">
      <h4 className="stat-card__title">{title}</h4>
      {hint === undefined ? null : <p className="stat-card__hint">{hint}</p>}
      {rows.length === 0 ? (
        <Blank>{empty}</Blank>
      ) : (
        <ul className="stat-rank">
          {rows.map((row) => (
            <li key={row.id} className="stat-rank__row">
              <span className="stat-rank__name" title={row.id}>{name(row.id)}</span>
              <span className="stat-rank__bar" aria-hidden="true">
                <span style={{ width: `${String(Math.max(2, (row.count / top) * 100))}%` }} />
              </span>
              <span className="stat-rank__n">{shown(row.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** 一行「名字 —— 值」。洞察那一栏全是这个形状。 */
function Line({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <li className="stat-line" {...(hint === undefined ? {} : { title: hint })}>
      <span className="stat-line__k">{label}</span>
      <span className="stat-line__v">{value}</span>
    </li>
  )
}

export function ActivityInsight({ digest }: { digest: ActivityDigest }): React.JSX.Element {
  const { totals } = digest
  const locale = useLocale()
  const m = ACTIVITY_TALLIES[locale]
  const big = (n: number): string => bigNumber(n, locale)
  return (
    <section className="stat-card">
      <h4 className="stat-card__title">{m.insight}</h4>
      <ul className="stat-lines">
        <Line label={m.asks} value={m.asksValue(big(totals.asks))} />
        <Line label={m.tools} value={m.timesValue(big(totals.tools))} />
        <Line
          label={m.approvals}
          value={m.timesValue(big(totals.approvals))}
          hint={m.approvalsHint}
        />
        <Line label={m.lanes} value={m.lanesValue(big(totals.lanes))} />
        <Line label={m.handoffs} value={m.timesValue(big(totals.handoffs))} hint={m.handoffsHint} />
        <Line label={m.projects} value={m.projectsValue(big(totals.projects))} />
        <Line label={m.activeDays} value={m.daysValue(big(totals.activeDays))} />
        {totals.peakDay === undefined ? null : (
          <Line
            label={m.peak}
            value={m.peakValue(dayText(totals.peakDay.date, locale), big(totals.peakDay.turns))}
          />
        )}
      </ul>
    </section>
  )
}

/**
 * 各家自己报的累计用量。
 *
 * **这一块的存在本身就是那句话**：口径各家不同，不能相加着看。
 * 实测同一台机器上一条长会话，一家报 250 万，另一家报 3.7 亿——
 * 后者把每次请求的整段上下文都重新计了一遍。所以这里只并排摆，不做任何合并解读。
 */
export function ActivityTokens({ digest, name }: {
  digest: ActivityDigest
  name: (id: string) => string
}): React.JSX.Element {
  const locale = useLocale()
  const m = ACTIVITY_TALLIES[locale]
  return (
    <section className="stat-card">
      <h4 className="stat-card__title">{m.tokensTitle}</h4>
      <p className="stat-card__hint">
        <strong>{m.tokensStrong}</strong>{m.tokensRest}
      </p>
      {digest.tokensByEngine.length === 0 ? (
        <Blank>{m.noTokens}</Blank>
      ) : (
        <ul className="stat-lines">
          {digest.tokensByEngine.map((row) => (
            <Line key={row.id} label={name(row.id)} value={m.tokenValue(bigNumber(row.count, locale))} />
          ))}
        </ul>
      )}
      {digest.tokenless.length === 0 ? null : (
        <p className="stat-card__hint">
          {m.tokenlessLead(m.join(digest.tokenless.map(name)))}
          <strong>{m.tokenlessStrong}</strong>{m.tokenlessRest}
        </p>
      )}
    </section>
  )
}

/** 四张排行榜。**空的那张照样摆出来**，空态里说清楚为什么空。 */
export function ActivityRanks({ digest, name }: {
  digest: ActivityDigest
  name: (id: string) => string
}): React.JSX.Element {
  const locale = useLocale()
  const m = useMessages(ACTIVITY_TALLIES)
  return (
    <>
      <TallyCard title={m.engines} rows={digest.engines} name={name} empty={m.enginesEmpty} format={m.turns} />
      <TallyCard title={m.toolsTitle} rows={digest.tools} empty={m.toolsEmpty} format={m.times} />
      <TallyCard
        title={m.models}
        hint={m.modelsHint}
        rows={digest.models}
        empty={m.modelsEmpty}
        format={m.turns}
      />
      <TallyCard
        title={m.efforts}
        rows={digest.efforts}
        name={(id) => effortLabel(id, locale).label}
        empty={m.effortsEmpty}
        format={m.turns}
      />
      <TallyCard
        title={m.commands}
        hint={m.commandsHint}
        rows={digest.commands}
        name={(id) => `/${id}`}
        empty={m.commandsEmpty}
        format={m.times}
      />
    </>
  )
}
