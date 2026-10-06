import type { Aside, Lane, LaneNode } from "@switchback/protocol"

const STATUS: Readonly<Record<Lane["status"], string>> = {
  running: "进行中",
  paused: "已暂停",
  done: "已完成",
  failed: "失败",
}

const NODE: Readonly<Record<LaneNode["state"], string>> = {
  pending: "待处理",
  running: "进行中",
  done: "完成",
  failed: "失败",
  skipped: "跳过",
}

function Mark({ status, live }: { status: Lane["status"]; live: boolean }): React.JSX.Element {
  return <span className={`branch__mark branch__mark--${status}${live ? " branch__mark--spin" : ""}`} aria-hidden="true" />
}

/** 旧日志兼容：当时侧问还挂在 `Thread.asides`，正文不能因升级消失。 */
export function LegacyAside({ aside }: { aside: Aside }): React.JSX.Element {
  return (
    <section className="sidecard" aria-label={`侧问：${aside.question}`}>
      <span className="sidecard__tag">侧问 · 已回答 · 不进正文</span>
      <p className="sidecard__q">{aside.question}</p>
      <p className="sidecard__a">{aside.answer}</p>
    </section>
  )
}

function AsideLane({ lane, live }: { lane: Lane; live: boolean }): React.JSX.Element {
  const running = lane.status === "running"
  const state = running && !live ? "状态待确认" : running ? "回答中" : lane.status === "paused" ? "已暂停" : lane.status === "failed" ? "失败" : "已回答"
  return (
    <section className={`sidecard sidecard--${lane.status}`} aria-label={`侧问：${lane.title}`} aria-live="polite">
      <span className="sidecard__tag">
        <Mark status={lane.status} live={running && live} />
        侧问 · {state} · 不进正文
      </span>
      <p className="sidecard__q">{lane.title}</p>
      {running ? null : <p className="sidecard__a">{lane.summary}</p>}
    </section>
  )
}

function Node({ node }: { node: LaneNode }): React.JSX.Element {
  return (
    <li className={node.parent === undefined ? "branch__node" : "branch__node branch__node--kid"} data-status={node.state}>
      <span className="branch__dot" aria-hidden="true" />
      <span className="branch__node-title">{node.label}</span>
      <span className="branch__node-state">{NODE[node.state]}</span>
      {node.detail === undefined ? null : <span className="branch__detail">{node.detail}</span>}
    </li>
  )
}

export function LaneCard({ lane, live }: { lane: Lane; live: boolean }): React.JSX.Element {
  if (lane.kind === "aside") return <AsideLane lane={lane} live={live} />
  const running = lane.status === "running"
  const nodes = lane.progress?.nodes ?? []
  return (
    <section className={`branch branch--${lane.status}`} aria-label={lane.title}>
      <header className="branch__head">
        <Mark status={lane.status} live={running && live} />
        <span className="branch__title">{lane.title}</span>
        <span className="branch__state">{running && !live ? "状态待确认" : STATUS[lane.status]}</span>
      </header>
      {lane.command === undefined ? null : (
        <code className="branch__cmd" title={lane.command}>{lane.command.replace(/\s+/g, " ").trim()}</code>
      )}
      {nodes.length === 0 ? null : <ul className="branch__tree">{nodes.map((node) => <Node key={node.id} node={node} />)}</ul>}
      {lane.summary === undefined ? null : (
        <p className={`branch__summary${lane.command === undefined ? "" : " branch__summary--out"}`}>{lane.summary}</p>
      )}
    </section>
  )
}
