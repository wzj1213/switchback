import type { Lane, LaneNode, ThreadId } from "@omni/protocol"

/**
 * claude 的 workflow 进度 → 一条 `Lane`。
 *
 * ## 数据从哪来
 *
 * `task_progress` 帧上的 `workflow_progress` 字段。**它不是一种 subtype，是一个字段**——
 * 上一版按 subtype 名去 grep（`sdk.d.ts` 与 `sdk.mjs` 各 0 处）就判它不存在，
 * 0 处是真的，**公开类型至今没声明它**，但它就搭在 `tasks.ts` 已经在解析的那一帧上。
 * 2026-08-19 活体抓到（10 帧里 4 帧带），原文贴在 `tasks.ts` 的头注释里。
 *
 * ## 一个 workflow 一条 lane，不是一个 agent 一条
 *
 * 整批共用**一个 `task_id`**，所以 lane id 就是它。每-agent 的明细进
 * `LaneProgress.nodes` —— 一个 30 agent 的 workflow 每 tick 产生 30 条
 * `lane.updated` 是不能接受的（`codec.ts` 的 SKIP 是黑名单，新事件默认全量落盘）。
 *
 * ## 三档阶梯，降级是结构性的不是版本嗅探
 *
 * 有 `workflow_progress` → 完整树；没有 → 一条 lane 一个节点（拿 `description`）。
 * **不判 SDK 版本**：字段在就画树，不在就画单节点。
 */

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined)
const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

interface RawEntry {
  type?: unknown
  index?: unknown
  title?: unknown
  label?: unknown
  phaseIndex?: unknown
  state?: unknown
  tokens?: unknown
  lastToolSummary?: unknown
  lastToolName?: unknown
}

/**
 * agent 状态词表。
 *
 * **认不出的按「在跑」画**：这一帧只在 workflow 活着的时候来，
 * 而把一个正在烧钱的 agent 画成 `pending`（还没开始）比画成 `running` 误导得多。
 */
const STATE: Readonly<Record<string, LaneNode["state"]>> = {
  pending: "pending",
  queued: "pending",
  running: "running",
  active: "running",
  done: "done",
  completed: "done",
  failed: "failed",
  error: "failed",
  skipped: "skipped",
}

const ENDED: ReadonlySet<LaneNode["state"]> = new Set(["done", "failed", "skipped"])

/**
 * 一组子节点 → 它们父节点的状态。**这是算出来的，不是引擎报的。**
 *
 * `workflow_phase` 帧上没有 state 字段（实测），而树上的阶段行总得显示点什么。
 * 算法只用引擎报上来的东西做算术（同 `synthDiff` 拿两份全文算增删行数），
 * 不引入任何 omni 自己的判断——但它终究是**推的**，所以写在这儿，
 * 免得下次有人拿它当「claude 说这个阶段完成了」。
 */
function rollUp(kids: readonly LaneNode["state"][]): LaneNode["state"] {
  if (kids.length === 0) return "pending"
  if (kids.includes("failed")) return "failed"
  if (kids.includes("running")) return "running"
  if (kids.every((s) => ENDED.has(s))) return kids.every((s) => s === "skipped") ? "skipped" : "done"
  return "pending"
}

interface Phase {
  title: string
  kids: LaneNode[]
}

/** 一条 `workflow_agent` → 一个节点。 */
function agentNode(raw: RawEntry, index: number): LaneNode {
  const tokens = int(raw.tokens)
  const detail = str(raw.lastToolSummary) ?? str(raw.lastToolName)
  const phase = int(raw.phaseIndex)
  return {
    id: `a${String(index)}`,
    label: str(raw.label) ?? `agent ${String(index)}`,
    state: STATE[str(raw.state) ?? ""] ?? "running",
    ...(phase === undefined ? {} : { parent: `p${String(phase)}` }),
    ...(detail === undefined ? {} : { detail }),
    // **0 不报**：那是在说「它没花钱」，而真相是「这一帧没带这个数」
    ...(tokens === undefined || tokens === 0 ? {} : { tokens }),
  }
}

/** 阶段行在前、它的 agent 紧跟着；界面靠 `parent` 缩进。阶段状态是 `rollUp` 算的。 */
function flatten(phases: Map<number, Phase>, loose: readonly LaneNode[]): readonly LaneNode[] {
  const out: LaneNode[] = []
  for (const [index, phase] of [...phases.entries()].sort((a, b) => a[0] - b[0])) {
    out.push({ id: `p${String(index)}`, label: phase.title, state: rollUp(phase.kids.map((k) => k.state)) })
    out.push(...phase.kids)
  }
  return [...out, ...loose]
}

/** 扁平节点表。 */
function nodesOf(entries: readonly RawEntry[]): readonly LaneNode[] {
  const phases = new Map<number, Phase>()
  const loose: LaneNode[] = []
  for (const raw of entries) {
    const index = int(raw.index)
    if (index === undefined) continue
    const type = str(raw.type)
    if (type === "workflow_phase") {
      register(phases, index).title = str(raw.title) ?? `阶段 ${String(index)}`
      continue
    }
    if (type !== "workflow_agent") continue
    const node = agentNode(raw, index)
    const phase = int(raw.phaseIndex)
    if (phase === undefined) loose.push(node)
    else register(phases, phase).kids.push(node)
  }
  return flatten(phases, loose)
}

/** 取或建。**agent 先于它的 phase 到达时也要占上位**——不占的话那一批会整个掉出树。 */
function register(phases: Map<number, Phase>, index: number): Phase {
  const known = phases.get(index)
  if (known !== undefined) return known
  const made: Phase = { title: `阶段 ${String(index)}`, kids: [] }
  phases.set(index, made)
  return made
}

/** 整条 lane 的状态。同 `rollUp`：**算出来的**，`task_progress` 不报终态。 */
function laneStatus(nodes: readonly LaneNode[]): Lane["status"] {
  const agents = nodes.filter((n) => n.parent !== undefined)
  const states = (agents.length > 0 ? agents : nodes).map((n) => n.state)
  const rolled = rollUp(states)
  return rolled === "failed" ? "failed" : rolled === "done" || rolled === "skipped" ? "done" : "running"
}

/**
 * 一帧 `task_progress` → 一条 lane。认不出形状就返回 undefined，静默丢弃。
 *
 * **`description` 缺席就整条不要**：拿 `last_tool_name` 拼一句「正在 Read」顶替，
 * 是 omni 在替引擎说话（同 `tasks.ts` 的规矩）。
 */
export function toLane(raw: unknown, threadId: ThreadId, at: number): Lane | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const msg = raw as { task_id?: unknown; description?: unknown; workflow_progress?: unknown }
  const id = str(msg.task_id)
  const description = str(msg.description)
  if (id === undefined || description === undefined) return undefined
  const entries = Array.isArray(msg.workflow_progress) ? (msg.workflow_progress as RawEntry[]) : undefined
  const head = { id, threadId, kind: "activity" as const, title: description, at, handle: id }
  // **没有 `workflow_progress` 那一档整个不报 `progress`。**
  //
  // 上一版在这儿造了一个「单节点」，节点的 label 就是 `description`——而卡片的标题
  // 也是它，于是同一句话在同一张卡上出现两遍，看起来像个 bug。
  // 缺席才是对的：`LaneProgress` 的契约写着「报不上来就缺席」，界面据此画转圈，
  // 而不是画一棵只有一个节点、内容还和标题重复的树。**不是缺陷是降级**——
  // Task 子 agent 那一路本来就没有阶段的概念。
  if (entries === undefined) return { ...head, status: "running" }
  const nodes = nodesOf(entries)
  return { ...head, status: laneStatus(nodes), progress: { nodes } }
}
