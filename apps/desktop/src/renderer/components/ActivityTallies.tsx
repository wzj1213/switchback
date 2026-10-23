import type { ActivityDigest, NameTally } from "../../shared/activity.js"
import { bigNumber, dayText } from "../activity-view.js"
import { effortLabel } from "./ModelPicker.js"
import { useLocale } from "../i18n.js"
import { Blank } from "./SettingsBits.js"

/**
 * 「活动」那一页下半截：洞察、各家用量、几张排行榜。
 *
 * 从页面主体拆出来是行数闸门逼的，但边界也对：上面那半截回答「多少」，
 * 这半截回答「都花在什么上」。
 */

/** 一张排行榜。条形的长度按**榜首**归一——它回答的是「谁占大头」，不是绝对值。 */
export function TallyCard({ title, hint, rows, empty, format = bigNumber, name = (id) => id }: {
  title: string
  hint?: string
  rows: readonly NameTally[]
  empty: string
  format?: (n: number) => string
  name?: (id: string) => string
}): React.JSX.Element {
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
              <span className="stat-rank__n">{format(row.count)}</span>
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
  return (
    <section className="stat-card">
      <h4 className="stat-card__title">活动洞察</h4>
      <ul className="stat-lines">
        <Line label="你说了多少句" value={`${bigNumber(totals.asks)} 条`} />
        <Line label="引擎调了多少次工具" value={`${bigNumber(totals.tools)} 次`} />
        <Line
          label="停下来问过你"
          value={`${bigNumber(totals.approvals)} 次`}
          hint="只算真的弹到你面前、要你点的那些；按规则自动放行的不进 transcript，也不在这里"
        />
        <Line label="子 agent 与 workflow" value={`${bigNumber(totals.lanes)} 条旁路`} />
        <Line label="中途换过引擎" value={`${bigNumber(totals.handoffs)} 次`} hint="一条会话里换了几回引擎" />
        <Line label="涉及的工作区" value={`${bigNumber(totals.projects)} 个`} />
        <Line label="有活动的天数" value={`${bigNumber(totals.activeDays)} 天`} />
        {totals.peakDay === undefined ? null : (
          <Line
            label="最忙的一天"
            value={`${dayText(totals.peakDay.date)} · ${bigNumber(totals.peakDay.turns)} 轮`}
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
  return (
    <section className="stat-card">
      <h4 className="stat-card__title">各家报的累计用量</h4>
      <p className="stat-card__hint">
        <strong>各家口径不是一回事</strong>，别把它们加起来当账单：有的引擎每次请求都把整段上下文重新计一遍，
        同一段历史会被反复计入。这里只照它自己报的数原样摆出来。
      </p>
      {digest.tokensByEngine.length === 0 ? (
        <Blank>还没有任何一家报过累计用量。</Blank>
      ) : (
        <ul className="stat-lines">
          {digest.tokensByEngine.map((row) => (
            <Line key={row.id} label={name(row.id)} value={`${bigNumber(row.count)} token`} />
          ))}
        </ul>
      )}
      {digest.tokenless.length === 0 ? null : (
        <p className="stat-card__hint">
          跑过、但一次都没报过累计用量：{digest.tokenless.map(name).join("、")}。
          <strong>这不等于没用过它</strong>——是 Switchback 手上没有这个数字。
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
  return (
    <>
      <TallyCard title="最常用的引擎" rows={digest.engines} name={name} empty="还没有跑过任何一轮。" format={(n) => `${String(n)} 轮`} />
      <TallyCard title="最常用的工具" rows={digest.tools} empty="引擎还没有调过工具。" format={(n) => `${String(n)} 次`} />
      <TallyCard
        title="最常用的模型"
        hint="只统计引擎真报了模型的那些轮次。"
        rows={digest.models}
        empty="这些轮次里没有一次带着明确的模型。"
        format={(n) => `${String(n)} 轮`}
      />
      <TallyCard
        title="最常用的思考档"
        rows={digest.efforts}
        name={(id) => effortLabel(id, locale).label}
        empty="用过的引擎都没有可切换的思考档。"
        format={(n) => `${String(n)} 轮`}
      />
      <TallyCard
        title="打过的斜杠命令"
        hint="按你输入框里打出的原文算。"
        rows={digest.commands}
        name={(id) => `/${id}`}
        empty="还没打过斜杠命令。"
        format={(n) => `${String(n)} 次`}
      />
    </>
  )
}
