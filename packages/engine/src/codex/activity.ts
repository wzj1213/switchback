import type { Event, Lane, LaneNode, ThreadId } from "@omni/protocol"

interface ActivityOut {
  threadId: ThreadId
  nativeThread: () => string | undefined
  emit: (event: Event) => void
  now: () => number
}

interface AgentState {
  id: string
  parent: string
  path: string
  root: string
  state: LaneNode["state"]
  at: number
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined

const object = (value: unknown): Record<string, unknown> => record(value) ?? {}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined

function statusState(value: unknown): LaneNode["state"] | undefined {
  if (value === "active") return "running"
  if (value === "idle") return "done"
  if (value === "systemError") return "failed"
  return undefined
}

function activityState(value: unknown): LaneNode["state"] | undefined {
  if (value === "started") return "running"
  if (value === "interrupted") return "failed"
  return undefined
}

function laneStatus(state: LaneNode["state"]): Lane["status"] {
  if (state === "done") return "done"
  if (state === "failed") return "failed"
  return "running"
}

function sameLane(left: Lane | undefined, right: Lane): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right)
}

interface SpawnedThread {
  parent: string
  child: string
  path: string
  state: LaneNode["state"] | undefined
}

function spawnedThread(params: unknown): SpawnedThread | undefined {
  const thread = object(object(params)["thread"])
  const spawned = object(object(object(thread["source"])["subAgent"])["thread_spawn"])
  const parent = str(spawned["parent_thread_id"])
  const child = str(thread["id"])
  const path = str(spawned["agent_path"])
  if (parent === undefined || child === undefined || path === undefined) return undefined
  return { parent, child, path, state: statusState(object(thread["status"])["type"]) }
}

/** Codex 原生子 thread → 持久 activity lane；不启动、不编排任何 agent。 */
export class CodexActivityTracker {
  private readonly agents = new Map<string, AgentState>()
  private readonly lanes = new Map<string, Lane>()

  constructor(private readonly out: ActivityOut) {}

  handle(method: string, params: unknown): boolean {
    if (method === "thread/started") return this.threadStarted(params)
    if (method === "thread/status/changed") return this.threadStatus(params)
    if (method === "item/started" || method === "item/completed") return this.activityItem(params)
    return false
  }

  private acceptsParent(parent: string): boolean {
    return parent === this.out.nativeThread() || this.agents.has(parent)
  }

  private threadStarted(params: unknown): boolean {
    const spawned = spawnedThread(params)
    if (spawned === undefined || !this.acceptsParent(spawned.parent)) return false
    this.adopt(spawned.child, spawned.parent, spawned.path, spawned.state)
    return true
  }

  private activityItem(params: unknown): boolean {
    const raw = record(params)
    const item = record(raw?.["item"])
    if (item?.["type"] !== "subAgentActivity") return false
    const parent = str(raw?.["threadId"])
    if (parent === undefined || !this.acceptsParent(parent)) return false
    const child = str(item["agentThreadId"])
    const path = str(item["agentPath"])
    if (child !== undefined && path !== undefined)
      this.adopt(child, parent, path, activityState(item["kind"]))
    return true
  }

  private threadStatus(params: unknown): boolean {
    const raw = record(params)
    const child = str(raw?.["threadId"])
    if (child === undefined || !this.agents.has(child)) return false
    const state = statusState(record(raw?.["status"])?.["type"])
    if (state !== undefined) this.update(child, state)
    return true
  }

  private rootOf(before: AgentState | undefined, id: string, parent: string): string | undefined {
    if (before !== undefined) return before.root
    if (parent === this.out.nativeThread()) return id
    return this.agents.get(parent)?.root
  }

  private adopt(
    id: string,
    parent: string,
    path: string,
    state: LaneNode["state"] | undefined,
  ): void {
    const before = this.agents.get(id)
    const root = this.rootOf(before, id, parent)
    if (root === undefined) return
    const at = this.out.now()
    this.agents.set(id, {
      id,
      parent,
      path,
      root,
      state: state ?? before?.state ?? "pending",
      at: before?.at ?? at,
    })
    if (state === undefined && before === undefined) return
    this.emit(root, at)
  }

  private update(id: string, state: LaneNode["state"]): void {
    const before = this.agents.get(id)
    if (before === undefined || before.state === state) return
    this.agents.set(id, { ...before, state })
    this.emit(before.root, this.out.now())
  }

  private emit(rootId: string, at: number): void {
    const root = this.agents.get(rootId)
    if (root === undefined) return
    const nodes = [...this.agents.values()]
      .filter((agent) => agent.root === rootId && agent.id !== rootId)
      .sort((left, right) => left.at - right.at || left.path.localeCompare(right.path))
      .map((agent): LaneNode => ({
        id: agent.id,
        label: agent.path,
        state: agent.state,
        ...(agent.parent === rootId ? {} : { parent: agent.parent }),
      }))
    const lane: Lane = {
      id: `codex-agent-${rootId}`,
      threadId: this.out.threadId,
      kind: "activity",
      title: root.path,
      status: laneStatus(root.state),
      at: root.at,
      handle: rootId,
      ...(nodes.length === 0 ? {} : { progress: { nodes } }),
    }
    if (sameLane(this.lanes.get(lane.id), lane)) return
    this.lanes.set(lane.id, lane)
    this.out.emit({ type: "lane.updated", at, threadId: this.out.threadId, lane })
  }
}
