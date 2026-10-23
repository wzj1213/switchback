import { useMemo } from "react"
import type { ActivityDigest } from "../../shared/activity.js"
import { bigNumber, durationParts } from "../activity-view.js"
import { bridge, useAsync, type Async } from "../use-async.js"
import { ActivityHeat } from "./ActivityHeat.js"
import { ActivityInsight, ActivityRanks, ActivityTokens } from "./ActivityTallies.js"
import { Actions, Blank, More } from "./SettingsBits.js"
import type { Locale } from "@switchback/i18n"
import { useLocale, useMessages } from "../i18n.js"
import { SETTINGS_ACTIVITY } from "./SettingsActivity.messages.js"

/**
 * 「活动」——**你在 Switchback 里到底干了多少**。
 *
 * ## 这一页只说磁盘上有的
 *
 * 它统计的是 Switchback 自己记下的那些会话，**不是「你用了多少 Claude」**：
 * 你在终端里跑的那些 Switchback 没有记录，引擎自己的账单 Switchback 也读不到。
 * 所以抬头那一行必须把口径写出来——一个看起来像账单、实际只覆盖一部分的数字，
 * 比没有这一页更糟。
 *
 * ## 为什么点进来才算
 *
 * 算一次要把 journal 整个走一遍（实测这台机器 17 条记录、28 MB，154 ms）。
 * 和这块面板别的几页同一条规矩：**没点到的那一页根本不挂载**。
 */

export interface ActivityProps {
  /** 引擎 id → 人话名。第三方引擎的名字只有宿主的清单知道，所以由上面传下来。 */
  engineName: (id: string) => string
  dataDir: string
  now: number
}

function Tile({ label, value, unit, tail, hint }: {
  label: string
  value: string
  unit?: string
  /** 零头（「21 小时」）。**退到小号**：大号字那一格只放得下一个数。 */
  tail?: string
  hint?: string
}): React.JSX.Element {
  return (
    <div className="stat-tile" {...(hint === undefined ? {} : { title: hint })}>
      <span className="stat-tile__v">
        {value}
        {unit === undefined || unit === "" ? null : <small>{unit}</small>}
        {tail === undefined ? null : <small>{tail}</small>}
      </span>
      <span className="stat-tile__k">{label}</span>
    </div>
  )
}

function Tiles({ digest }: { digest: ActivityDigest }): React.JSX.Element {
  const { totals } = digest
  const locale = useLocale()
  const m = SETTINGS_ACTIVITY[locale]
  return (
    <div className="stat__tiles">
      <Tile label={m.threads} value={bigNumber(totals.threads, locale)} unit={m.threadsUnit} />
      <Tile label={m.turns} value={bigNumber(totals.turns, locale)} unit={m.turnsUnit} hint={m.turnsHint} />
      <Tile
        label={m.longest}
        {...(totals.longest === undefined ? { value: "—" } : durationParts(totals.longest.ms, locale))}
        hint={totals.longest === undefined ? undefined : m.longestHint(totals.longest.title)}
      />
      <Tile label={m.streak} value={String(totals.streak)} unit={m.daysUnit} hint={m.streakHint} />
      <Tile label={m.best} value={String(totals.bestStreak)} unit={m.daysUnit} />
    </div>
  )
}

/** 抬头那一行：**这份统计是从哪儿来的、覆盖到哪儿**。 */
function Lead({ digest, dataDir }: { digest: ActivityDigest; dataDir: string }): React.JSX.Element {
  const locale = useLocale()
  const m = SETTINGS_ACTIVITY[locale]
  const span = digest.since === undefined ? m.noRecords : spanOf(digest.since, digest.until ?? digest.since, locale)
  // 路径写短名、完整的放在悬停里：数据页那三行同一个做法，一长串临时目录读起来只是噪声
  return (
    <p className="set__note stat__lead">
      {m.leadBefore}<strong>{m.leadStrong}</strong>
      {m.leadOpen}<span title={`${dataDir}/threads`}>{m.dataDir}</span>{m.leadRecords(digest.threads, span)}
      <strong>{m.leadStrong2}</strong>{m.leadEnd}
      {digest.skipped === 0 ? null : m.skipped(digest.skipped)}
      <More>{m.more}</More>
    </p>
  )
}



/** 「2026 年 8 月 22 日—8 月 25 日」：同一年就不再写第二遍年份。 */
function spanOf(since: number, until: number, locale: Locale): string {
  const m = SETTINGS_ACTIVITY[locale]
  const sameYear = new Date(since).getFullYear() === new Date(until).getFullYear()
  return m.span(m.stamp(since, true), m.stamp(until, !sameYear))
}

export function ActivitySection(props: ActivityProps): React.JSX.Element {
  const switchback = bridge()
  // **稳定引用**：`useAsync` 拿它当 effect 依赖，每帧新造一个函数会让这一页一直重扫。
  // `again` 直接转给主进程——点了「重新统计」就是要它无视缓存，而不是再拿一次旧的
  const load = useMemo(
    () => (switchback === undefined ? undefined : (again: boolean) => switchback.activity(again)),
    [switchback],
  )
  const state = useAsync<ActivityDigest>(load)
  const m = useMessages(SETTINGS_ACTIVITY)
  if (state.data === undefined) {
    return state.failed ? (
      <Blank tone="error">{m.failed}</Blank>
    ) : (
      <Blank>{m.loading}</Blank>
    )
  }
  return <Loaded digest={state.data} props={props} state={state} />
}

function Loaded({ digest, props, state }: {
  digest: ActivityDigest
  props: ActivityProps
  state: Async<ActivityDigest>
}): React.JSX.Element {
  const m = useMessages(SETTINGS_ACTIVITY)
  return (
    <div className="stat">
      <Lead digest={digest} dataDir={props.dataDir} />
      {state.failed ? <Blank tone="error">{m.refreshFailed}</Blank> : null}
      <Tiles digest={digest} />
      <ActivityHeat days={digest.days} now={props.now} />
      {/* 七张卡按两栏**顺着排满**（CSS 多栏），不按行对齐：一行里一高一矮时，
          矮的那张底下会空出一大块，整页看着东缺一块西缺一块 */}
      <div className="stat__grid">
        <ActivityInsight digest={digest} />
        <ActivityTokens digest={digest} name={props.engineName} />
        <ActivityRanks digest={digest} name={props.engineName} />
      </div>
      <Actions>
        <span className="set__hint stat__foot">{m.took(digest.threads, digest.ms)}</span>
        <button
          type="button"
          className="tbtn"
          disabled={state.loading}
          onClick={state.reload}
        >
          {state.loading ? m.counting : m.recount}
        </button>
      </Actions>
    </div>
  )
}
