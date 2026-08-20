import type { Event, ItemId, ToolCallItem, TurnId, TurnStatus } from "@omni/protocol"
import { planSteps } from "./plan.js"
import { finishTool, startTool, sweepTool } from "./tool.js"
import { kimiMessage, kimiTurnStatus, snapshotCanFinish, snapshotMatches } from "./turn-state.js"
import type { KimiPayload, KimiSnapshot } from "./wire.js"

interface TextState {
  id: ItemId
  kind: "agent_message" | "reasoning"
  text: string
  /** Kimi 快照给的是整轮累计文本；分段后仍靠它只补缺失的后缀。 */
  total: string
  started: boolean
  part: number
}

interface Active {
  generation: number
  turnId: TurnId
  prompt: string
  promptId?: string
  native?: number
  assistant: TextState
  reasoning: TextState
  /** 当前连续文本的类型。换类型或插入工具时，旧片段就地收口。 */
  openText?: TextState["kind"]
  tools: Map<string, ToolCallItem>
  planStarted: boolean
  retryStarted: boolean
  noticeSeq: number
}

export interface TurnTrackerDeps {
  emit: (event: Event) => void
  now: () => number
}

function textState(turnId: TurnId, kind: TextState["kind"], part = 1, total = ""): TextState {
  const prefix = kind === "agent_message" ? "kimi-answer" : "kimi-thinking"
  const id = part === 1 ? `${prefix}-${turnId}` : `${prefix}-${turnId}-${String(part)}`
  return { id, kind, text: "", total, started: false, part }
}

export class KimiTurnTracker {
  private active: Active | undefined
  private serial = 0

  constructor(private readonly deps: TurnTrackerDeps) {}

  begin(turnId: TurnId, prompt: string): number {
    if (this.active !== undefined) throw new Error("Kimi 还有一轮正在运行")
    const generation = ++this.serial
    this.active = {
      generation,
      turnId,
      prompt,
      assistant: textState(turnId, "agent_message"),
      reasoning: textState(turnId, "reasoning"),
      tools: new Map(),
      planStarted: false,
      retryStarted: false,
      noticeSeq: 0,
    }
    return generation
  }

  promptAccepted(generation: number, promptId: string): void {
    if (this.active?.generation === generation) this.active.promptId = promptId
  }

  isActive(generation: number): boolean {
    return this.active?.generation === generation
  }

  hasActive(): boolean {
    return this.active !== undefined
  }

  currentGeneration(): number | undefined {
    return this.active?.generation
  }

  currentPromptId(): string | undefined {
    return this.active?.promptId
  }

  private bind(native: number | undefined, prompt?: string): Active | undefined {
    const active = this.active
    if (active === undefined || native === undefined) return undefined
    if (active.native !== undefined) return active.native === native ? active : undefined
    if (prompt !== undefined && prompt !== active.prompt) return undefined
    active.native = native
    return active
  }

  started(payload: KimiPayload): void {
    this.bind(payload.turnId, payload.prompt)
  }

  private append(state: TextState, active: Active, delta: string, at: number): void {
    if (delta === "") return
    if (!state.started) {
      state.started = true
      state.text = delta
      state.total = delta
      this.deps.emit({
        type: "item.started",
        at,
        item: { id: state.id, turnId: active.turnId, at, kind: state.kind, text: delta, complete: false },
      })
      return
    }
    state.text += delta
    state.total += delta
    this.deps.emit({ type: "item.delta", at, itemId: state.id, append: delta })
  }

  private stateOf(active: Active, kind: TextState["kind"]): TextState {
    return kind === "reasoning" ? active.reasoning : active.assistant
  }

  private rotateText(state: TextState, active: Active, at: number): void {
    if (!state.started) return
    this.finishText(state, active, at)
    const next = textState(active.turnId, state.kind, state.part + 1, state.total)
    if (state.kind === "reasoning") active.reasoning = next
    else active.assistant = next
  }

  private selectText(active: Active, kind: TextState["kind"], at: number): TextState {
    if (active.openText !== undefined && active.openText !== kind) {
      this.rotateText(this.stateOf(active, active.openText), active, at)
    }
    active.openText = kind
    return this.stateOf(active, kind)
  }

  /** 任何真正插进 transcript 的非文本 item 都会切断连续文本。 */
  private closeText(active: Active, at: number): void {
    this.rotateText(active.reasoning, active, at)
    this.rotateText(active.assistant, active, at)
    active.openText = undefined
  }

  delta(payload: KimiPayload, kind: TextState["kind"], at: number): void {
    const active = this.bind(payload.turnId)
    if (active === undefined || payload.delta === undefined) return
    this.append(this.selectText(active, kind, at), active, payload.delta, at)
  }

  toolStarted(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    if (active === undefined) return
    const steps = planSteps(payload.display)
    if (steps !== undefined) {
      if (steps.length > 0) {
        this.closeText(active, at)
        this.deps.emit({
          type: active.planStarted ? "item.updated" : "item.started",
          at,
          item: { id: `kimi-plan-${active.turnId}`, turnId: active.turnId, at, kind: "plan", steps },
        })
        active.planStarted = true
      }
      return
    }
    const item = startTool(payload, active.turnId, at)
    if (item === undefined || active.tools.has(item.id)) return
    this.closeText(active, at)
    active.tools.set(item.id, item)
    this.deps.emit({ type: "item.started", at, item })
  }

  toolProgress(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    const item = active?.tools.get(payload.toolCallId ?? "")
    const text = payload.update?.text
    if (item?.detail.kind !== "shell" || text === undefined || text === "") return
    active?.tools.set(item.id, {
      ...item,
      detail: { ...item.detail, output: `${item.detail.output ?? ""}${text}` },
    })
    this.deps.emit({ type: "item.delta", at, itemId: item.id, append: text })
  }

  toolResult(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    const item = active?.tools.get(payload.toolCallId ?? "")
    if (active === undefined || item === undefined) return
    const done = finishTool(item, payload.output, payload.isError === true)
    active.tools.set(done.id, done)
    this.deps.emit({ type: "item.updated", at, item: done })
  }

  notice(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    const message = payload.message ?? kimiMessage(payload.error)
    if (active === undefined || message === undefined) return
    this.closeText(active, at)
    active.noticeSeq += 1
    const id = `kimi-error-${active.turnId}-${String(at)}-${String(active.noticeSeq)}`
    this.deps.emit({
      type: "item.started",
      at,
      item: { id, turnId: active.turnId, at, kind: "error", message, fatal: payload.retryable !== true },
    })
  }

  retry(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    if (active === undefined) return
    this.closeText(active, at)
    const message = typeof payload.errorMessage === "string" ? payload.errorMessage : "Kimi 正在重试这一轮"
    const id = `kimi-retry-${active.turnId}`
    this.deps.emit({
      type: active.retryStarted ? "item.updated" : "item.started",
      at,
      item: { id, turnId: active.turnId, at, kind: "error", message, fatal: false },
    })
    active.retryStarted = true
  }

  ended(payload: KimiPayload, at: number): void {
    const active = this.bind(payload.turnId)
    if (active === undefined) return
    this.complete(active, kimiTurnStatus(payload.reason), at, kimiMessage(payload.error))
  }

  private finishText(state: TextState, active: Active, at: number): void {
    if (!state.started) return
    this.deps.emit({
      type: "item.updated",
      at,
      item: { id: state.id, turnId: active.turnId, at, kind: state.kind, text: state.text, complete: true },
    })
  }

  private complete(active: Active, status: TurnStatus, at: number, error?: string): void {
    this.finishText(active.reasoning, active, at)
    this.finishText(active.assistant, active, at)
    const ending = status === "interrupted" ? "interrupted" : "failed"
    for (const item of active.tools.values()) {
      const missing = status === "completed" && (item.status === "running" || item.status === "pending")
      const swept = missing
        ? { ...item, status: "failed" as const, error: "Kimi 在轮次结束前没有报告这次工具调用的结果。" }
        : sweepTool(item, ending)
      if (swept !== item) this.deps.emit({ type: "item.updated", at, item: swept })
    }
    this.active = undefined
    this.deps.emit({
      type: "turn.completed",
      at,
      turnId: active.turnId,
      status,
      ...(error === undefined ? {} : { error }),
    })
  }

  fail(message: string): void {
    const active = this.active
    if (active === undefined) return
    this.complete(active, "failed", this.deps.now(), message)
  }

  failGeneration(generation: number, message: string): void {
    if (this.isActive(generation)) this.fail(message)
  }

  private syncText(state: TextState, active: Active, text: string, at: number): void {
    if (text === "" || text === state.total) return
    const closedLength = state.total.length - state.text.length
    const segment = text.slice(Math.min(closedLength, text.length))
    state.total = text
    if (segment === "" && !state.started) return
    const selected = this.selectText(active, state.kind, at)
    selected.text = segment
    selected.total = text
    const item = { id: selected.id, turnId: active.turnId, at, kind: selected.kind, text: segment, complete: false } as const
    if (!selected.started) {
      selected.started = true
      this.deps.emit({ type: "item.started", at, item })
      return
    }
    this.deps.emit({ type: "item.updated", at, item })
  }

  reconcile(snapshot: KimiSnapshot): void {
    const active = this.active
    if (active === undefined) return
    const at = this.deps.now()
    const flight = snapshot.in_flight_turn
    if (flight === null) {
      // `begin()` 发生在图片编码与 POST 之前；这段窗口里的空闲快照说的是旧状态，
      // 不能拿它把刚创建、甚至还没送到服务端的新轮次提前收掉。
      if (!snapshotCanFinish(active.promptId, snapshot)) return
      this.complete(active, kimiTurnStatus(snapshot.session.last_turn_reason), at)
      return
    }
    if (!snapshotMatches(active.native, active.promptId, snapshot)) return
    if (this.bind(flight.turn_id) === undefined) return
    active.promptId ??= flight.current_prompt_id
    this.syncText(active.reasoning, active, flight.thinking_text, at)
    this.syncText(active.assistant, active, flight.assistant_text, at)
    for (const tool of flight.running_tools) {
      this.toolStarted(
        { turnId: flight.turn_id, toolCallId: tool.tool_call_id, name: tool.name, args: tool.args, display: tool.display },
        at,
      )
      if (tool.last_progress?.text !== undefined) {
        this.toolProgress({ turnId: flight.turn_id, toolCallId: tool.tool_call_id, update: tool.last_progress }, at)
      }
    }
  }
}

type TurnHandler = (tracker: KimiTurnTracker, payload: KimiPayload, at: number) => void

const TURN_HANDLERS: Readonly<Record<string, TurnHandler>> = {
  "turn.started": (tracker, payload) => tracker.started(payload),
  "assistant.delta": (tracker, payload, at) => tracker.delta(payload, "agent_message", at),
  "thinking.delta": (tracker, payload, at) => tracker.delta(payload, "reasoning", at),
  "tool.call.started": (tracker, payload, at) => tracker.toolStarted(payload, at),
  "tool.progress": (tracker, payload, at) => tracker.toolProgress(payload, at),
  "tool.result": (tracker, payload, at) => tracker.toolResult(payload, at),
  "turn.step.retrying": (tracker, payload, at) => tracker.retry(payload, at),
  error: (tracker, payload, at) => tracker.notice(payload, at),
  warning: (tracker, payload, at) => tracker.notice(payload, at),
  "turn.ended": (tracker, payload, at) => tracker.ended(payload, at),
}

export function handleTurnEvent(tracker: KimiTurnTracker, payload: KimiPayload, at: number): void {
  const type = payload.type
  if (type !== undefined) TURN_HANDLERS[type]?.(tracker, payload, at)
}
