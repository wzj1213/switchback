import { useEffect, useMemo, useRef } from "react"
import type { Item, Lane, Thread } from "@omni/protocol"
import type { ResolveApproval } from "./Approval.js"
import { groupRows } from "../group.js"
import { compact } from "../usage.js"
import { Copyable } from "./Copyable.js"
import { lastSpoken } from "./transcript-row.js"
import { ItemView } from "./ItemView.js"
import { LaneTree } from "./LaneTree.js"
import { LaneCommandBlock, LaneCommandLine, LaneOutput } from "./lane-command.js"
import { PlanMark, type MarkState } from "./PlanMark.js"
import { ToolRun } from "./ToolRun.js"
import { ChevronIcon } from "./icons.js"
import { focusActivity, focusFirstActivity, moveActivityFocus } from "./activity-navigation.js"

const MARK: Readonly<Record<Lane["status"], MarkState>> = {
  running: "in_progress",
  paused: "pending",
  done: "done",
  failed: "failed",
}
const LABEL: Readonly<Record<Lane["status"], string>> = {
  running: "正在运行",
  paused: "已暂停",
  done: "已完成",
  failed: "失败",
}
const ignoreApproval: ResolveApproval = () => undefined

/** 一条命令一个「节点」不值得报数——那一行读起来像凑数的。 */
function nodeCount(lane: Lane): string {
  const nodes = lane.progress?.nodes.length ?? 0
  return nodes > 1 ? ` · ${String(nodes)} 个节点` : ""
}

function ordered(lanes: readonly Lane[]): readonly Lane[] {
  return [...lanes].sort((a, b) => {
    const aLive = a.status === "running" || a.status === "paused"
    const bLive = b.status === "running" || b.status === "paused"
    return aLive === bLive ? b.at - a.at : aLive ? -1 : 1
  })
}

function ActivityIndex({ lanes, hidden, root, onPick }: {
  lanes: readonly Lane[]
  hidden: boolean
  root: React.RefObject<HTMLDivElement | null>
  onPick: (id: string) => void
}): React.JSX.Element {
  return (
    <div ref={root} className="activity-list" hidden={hidden}>
      {lanes.length === 0 ? <p className="workbench__empty">这条任务还没有后台活动。</p> : null}
      {ordered(lanes).map((lane) => {
        const live = lane.status === "running"
        return (
          <button key={lane.id} type="button" className="activity-row" data-lane-id={lane.id}
            aria-keyshortcuts="ArrowUp ArrowDown Home End" onKeyDown={moveActivityFocus}
            onClick={() => { onPick(lane.id) }}>
            <span className="activity-row__mark"><PlanMark status={MARK[lane.status]} spinning={live} /></span>
            <span className="activity-row__copy">
              <span className="activity-row__title">{lane.title}</span>
              {lane.command === undefined ? null : <LaneCommandLine command={lane.command} />}
              <span className="activity-row__meta">
                {LABEL[lane.status]}
                {nodeCount(lane)}
              </span>
            </span>
            <ChevronIcon size={11} />
          </button>
        )
      })}
    </div>
  )
}

function ActivityFeed({ items, threadId, cwd, onCopy }: {
  items: readonly Item[]
  threadId: string
  cwd: string
  onCopy: (text: string) => void
}): React.JSX.Element | null {
  const rows = useMemo(() => groupRows(items), [items])
  // 和转录区同一条规矩：动作只挂最后一条说出来的话（见 `Copyable.tsx`）
  const spoken = lastSpoken(rows)
  if (rows.length === 0) return null
  return (
    <div className="activity-feed">
      <div className="workbench__section">过程</div>
      {rows.map((row) => {
        if (row.kind === "run") {
          return <ToolRun key={row.items[0]?.id} items={row.items} threadId={threadId} cwd={cwd} />
        }
        if (row.kind !== "item") return null
        return (
          <Copyable key={row.item.id} item={row.item} acts={row.item.id === spoken} onCopy={onCopy}>
            <ItemView item={row.item} onResolve={ignoreApproval} readOnly
              approvalTurn={undefined} shortcutApproval={undefined} />
          </Copyable>
        )
      })}
    </div>
  )
}

/**
 * 结论那一块。**命令的输出按等宽画，别人的总结按正文画**——
 * 一段 shell 输出塞进正文段落里，缩进和列都没了，等于没给。
 */
function LaneConclusion({ lane }: { lane: Lane }): React.JSX.Element | null {
  if (lane.summary === undefined) return null
  if (lane.command === undefined) return <p className="activity-detail__summary">{lane.summary}</p>
  return (
    <>
      <div className="workbench__section">输出片段</div>
      <LaneOutput text={lane.summary} />
    </>
  )
}

function LaneDetail({ lane, items, thread, onBack, onCopy }: {
  lane: Lane
  items: readonly Item[]
  thread: Thread
  onBack: () => void
  onCopy: (text: string) => void
}): React.JSX.Element {
  const nodes = lane.progress?.nodes ?? []
  const budget = lane.progress?.budget
  const live = lane.status === "running" && thread.detached !== true
  return (
    <div className="activity-detail">
      <button type="button" className="workbench__back" onClick={onBack}>
        <ChevronIcon size={11} /> 全部活动
      </button>
      <header className="activity-detail__head">
        <span className="activity-row__mark"><PlanMark status={MARK[lane.status]} spinning={live} /></span>
        <div className="activity-row__copy">
          <strong>{lane.title}</strong>
          <span className="activity-row__meta">
            {LABEL[lane.status]}
            {budget === undefined ? "" : ` · ${compact(budget.used)} tokens`}
          </span>
        </div>
      </header>
      <div className="activity-detail__scroll">
        {nodes.length === 0 ? null : <LaneTree nodes={nodes} live={live} />}
        {lane.command === undefined ? null : <LaneCommandBlock command={lane.command} onCopy={onCopy} />}
        <LaneConclusion lane={lane} />
        <ActivityFeed items={items} threadId={thread.id} cwd={thread.cwd} onCopy={onCopy} />
        {nodes.length === 0 && lane.summary === undefined && lane.command === undefined && items.length === 0 ? (
          <p className="workbench__empty">引擎只报告了这条活动的存在，还没有给出逐步明细。</p>
        ) : null}
      </div>
    </div>
  )
}

export function ActivityPage({ lanes, laneId, items, thread, onPick, onBack, onCopy }: {
  lanes: readonly Lane[]
  laneId: string | undefined
  items: readonly Item[]
  thread: Thread
  onPick: (id: string) => void
  onBack: () => void
  onCopy: (text: string) => void
}): React.JSX.Element {
  const lane = lanes.find((candidate) => candidate.id === laneId)
  const own = useMemo(() => items.filter((item) => item.lane?.id === lane?.id), [items, lane?.id])
  const root = useRef<HTMLDivElement>(null)
  const returnLane = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (lane !== undefined || returnLane.current === undefined) return
    const id = returnLane.current
    returnLane.current = undefined
    if (!focusActivity(root.current, id)) focusFirstActivity(root.current)
  }, [lane])
  const pick = (id: string): void => {
    returnLane.current = id
    onPick(id)
  }
  return (
    <>
      <ActivityIndex lanes={lanes} hidden={lane !== undefined} root={root} onPick={pick} />
      {lane === undefined ? null : (
        <LaneDetail lane={lane} items={own} thread={thread} onBack={onBack} onCopy={onCopy} />
      )}
    </>
  )
}
