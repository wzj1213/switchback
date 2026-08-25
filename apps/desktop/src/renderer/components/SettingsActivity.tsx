import { useMemo } from "react"
import type { ActivityDigest } from "../../shared/activity.js"
import { bigNumber, durationParts } from "../activity-view.js"
import { bridge, useAsync, type Async } from "../use-async.js"
import { ActivityHeat } from "./ActivityHeat.js"
import { ActivityInsight, ActivityRanks, ActivityTokens } from "./ActivityTallies.js"
import { Actions, Blank } from "./SettingsBits.js"

/**
 * 「活动」——**你在 omni 里到底干了多少**。
 *
 * ## 这一页只说磁盘上有的
 *
 * 它统计的是 omni 自己记下的那些会话，**不是「你用了多少 Claude」**：
 * 你在终端里跑的那些 omni 没有记录，引擎自己的账单 omni 也读不到。
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
        {unit === undefined ? null : <small>{unit}</small>}
        {tail === undefined ? null : <small>{tail}</small>}
      </span>
      <span className="stat-tile__k">{label}</span>
    </div>
  )
}

function Tiles({ digest }: { digest: ActivityDigest }): React.JSX.Element {
  const { totals } = digest
  return (
    <div className="stat__tiles">
      <Tile label="会话" value={bigNumber(totals.threads)} unit="条" />
      <Tile label="轮次" value={bigNumber(totals.turns)} unit="轮" hint="一轮 = 从你发出一句话到引擎交还控制权" />
      <Tile
        label="最长的一条会话"
        {...(totals.longest === undefined ? { value: "—" } : durationParts(totals.longest.ms))}
        hint={totals.longest === undefined ? undefined : `《${totals.longest.title}》从第一条记录到最后一条`}
      />
      <Tile label="当前连续" value={String(totals.streak)} unit="天" hint="今天还没动、但昨天动过，仍然算连着" />
      <Tile label="最长连续" value={String(totals.bestStreak)} unit="天" />
    </div>
  )
}

/** 抬头那一行：**这份统计是从哪儿来的、覆盖到哪儿**。 */
function Lead({ digest, dataDir }: { digest: ActivityDigest; dataDir: string }): React.JSX.Element {
  const span = digest.since === undefined
    ? "还没有任何记录"
    : `${stamp(digest.since)} 起，到 ${stamp(digest.until ?? digest.since)}`
  return (
    <p className="set__note stat__lead">
      统计的是 <strong>omni 自己记下的那些会话</strong>（{dataDir}/threads 里的 {digest.threads} 条记录，{span}）。
      你在终端里直接跑引擎的那些不在这儿，引擎自己的账单 omni 也读不到——
      <strong>这不是账单，是你在 omni 里的工作量</strong>。
      {digest.skipped === 0 ? null : ` 有 ${String(digest.skipped)} 条记录读不动，已跳过。`}
    </p>
  )
}

function stamp(at: number): string {
  const d = new Date(at)
  return `${String(d.getFullYear())} 年 ${String(d.getMonth() + 1)} 月 ${String(d.getDate())} 日`
}

export function ActivitySection(props: ActivityProps): React.JSX.Element {
  const omni = bridge()
  // **稳定引用**：`useAsync` 拿它当 effect 依赖，每帧新造一个函数会让这一页一直重扫。
  // `again` 直接转给主进程——点了「重新统计」就是要它无视缓存，而不是再拿一次旧的
  const load = useMemo(
    () => (omni === undefined ? undefined : (again: boolean) => omni.activity(again)),
    [omni],
  )
  const state = useAsync<ActivityDigest>(load)

  if (state.data === undefined) {
    return state.failed ? (
      <Blank tone="error">读不出活动统计。这一页要把会话记录整个走一遍，可以稍后再试。</Blank>
    ) : (
      <Blank>正在把会话记录走一遍…</Blank>
    )
  }
  return <Loaded digest={state.data} props={props} state={state} />
}

function Loaded({ digest, props, state }: {
  digest: ActivityDigest
  props: ActivityProps
  state: Async<ActivityDigest>
}): React.JSX.Element {
  return (
    <div className="stat">
      <Lead digest={digest} dataDir={props.dataDir} />
      {state.failed ? <Blank tone="error">刚才那次重新统计没成功，下面还是上一次的结果。</Blank> : null}
      <Tiles digest={digest} />
      <ActivityHeat days={digest.days} now={props.now} />
      <div className="stat__grid">
        <ActivityInsight digest={digest} />
        <ActivityTokens digest={digest} name={props.engineName} />
      </div>
      <div className="stat__grid">
        <ActivityRanks digest={digest} name={props.engineName} />
      </div>
      <Actions>
        <span className="set__hint stat__foot">走完这 {digest.threads} 条记录用了 {String(digest.ms)} ms</span>
        <button
          type="button"
          className="tbtn"
          disabled={state.loading}
          onClick={state.reload}
        >
          {state.loading ? "统计中…" : "重新统计"}
        </button>
      </Actions>
    </div>
  )
}
