import type { ApprovalItem, Event, ItemId, QuestionId, QuestionResponse, TurnId } from "@switchback/protocol"
import type { ApprovalAnswer, ApprovalAsk } from "@switchback/engine"

export interface OpenRequest {
  ask: ApprovalAsk
  turnId: TurnId
  at: number
  /** 审批卡自己的 item id（与被审批的工具调用 id 不同） */
  itemId: ItemId
}

export interface Gate {
  /** 发一张审批卡进 transcript，返回一个等用户落定的 promise */
  open: (req: OpenRequest) => Promise<ApprovalAnswer>
  /** 渲染层落定。命中返回 true；找不到（重复点击、已 settle）返回 false。 */
  resolve: (itemId: ItemId, answer: ApprovalAnswer) => boolean
  /** 挂起一组结构化问题；`onSettled` 在 promise 续体之前同步清掉 Thread 投影。 */
  openQuestion: (
    questionId: QuestionId,
    onSettled: () => void,
  ) => Promise<QuestionResponse>
  /** 桌面或远程端落定一组问题。 */
  resolveQuestion: (questionId: QuestionId, response: QuestionResponse) => boolean
  /**
   * 主轮之外来的审批（`Thread.pendingApprovals`）：不往转录区发卡，只挂一个等落定的 promise。
   * `onSettled` 在续体之前同步调用，用来清掉会话上的那一项。落定、撤销走同一套 `resolve` / `cancelApproval`。
   */
  hold: (itemId: ItemId, onSettled: () => void) => Promise<ApprovalAnswer>
  /** 引擎已经撤销请求；解开 promise，但不把「过期」冒充成用户拒绝。 */
  cancelApproval: (itemId: ItemId) => boolean
  cancelQuestion: (questionId: QuestionId) => boolean
  /**
   * 收掉主轮的：转录区里挂着的审批卡、问题。**主轮之外来的审批留着**（`hold`）——
   * 主轮收工、按停止都只管主轮自己的活，后台子 agent 还在等人，引擎撤不撤由它自己的信号说。
   *
   * 调它的全是**不是用户点的**收口，所以卡片记成「已失效」而不是「已拒绝」：
   * 那会让一次中断在回放里读起来像「用户明确拒绝了这次调用」。
   */
  settleTurn: () => void
  /**
   * 连同主轮之外的一起收掉。背后的进程要走了（关会话、换引擎、改档重启、被收起、退出）时调——
   * 否则驱动会永远等在 `canUseTool` 里，`dispose()` 挂死。
   */
  settleAll: () => void
}

interface Pending {
  resolve: (answer: ApprovalAnswer) => void
  item: ApprovalItem
}

interface PendingQuestion {
  resolve: (response: QuestionResponse) => void
  onSettled: () => void
}

interface Held {
  resolve: (answer: ApprovalAnswer) => void
  onSettled: () => void
}

const DENIED: ApprovalAnswer = { allow: false, remember: "once" }
const DISMISSED: QuestionResponse = { dismissed: true }

function card(req: OpenRequest, status: ApprovalItem["status"]): ApprovalItem {
  return {
    id: req.itemId,
    turnId: req.turnId,
    kind: "approval",
    at: req.at,
    toolCallId: req.ask.toolCallId,
    tool: req.ask.tool,
    summary: req.ask.summary,
    status,
    reason: req.ask.reason,
    ...(req.ask.rememberHint === undefined ? {} : { rememberHint: req.ask.rememberHint }),
    ...(req.ask.origin === undefined ? {} : { origin: req.ask.origin }),
  }
}

/** 主轮之外来的审批：只有一个等落定的 promise，没有转录区里的卡（见 `Gate.hold`）。 */
function createHeld(): {
  hold: Gate["hold"]
  release: (itemId: ItemId, answer: ApprovalAnswer) => boolean
  ids: () => ItemId[]
} {
  const held = new Map<ItemId, Held>()
  return {
    hold: (itemId, onSettled) =>
      new Promise<ApprovalAnswer>((resolve) => {
        held.set(itemId, { resolve, onSettled })
      }),
    release: (itemId, answer) => {
      const entry = held.get(itemId)
      if (entry === undefined) return false
      held.delete(itemId)
      entry.onSettled()
      entry.resolve(answer)
      return true
    },
    ids: () => [...held.keys()],
  }
}

export function createGate(emit: (event: Event) => void): Gate {
  const pending = new Map<ItemId, Pending>()
  const questions = new Map<QuestionId, PendingQuestion>()
  const { hold, release, ids } = createHeld()

  const settle = (itemId: ItemId, answer: ApprovalAnswer, at: number): boolean => {
    const entry = pending.get(itemId)
    if (entry === undefined) return release(itemId, answer)
    pending.delete(itemId)
    const status = answer.allow ? "allowed" : "denied"
    emit({ type: "item.updated", at, item: { ...entry.item, status } })
    entry.resolve(answer)
    return true
  }

  const settleQuestion = (questionId: QuestionId, response: QuestionResponse): boolean => {
    const entry = questions.get(questionId)
    if (entry === undefined) return false
    questions.delete(questionId)
    entry.onSettled()
    entry.resolve(response)
    return true
  }

  const cancelApproval = (itemId: ItemId): boolean => {
    const entry = pending.get(itemId)
    if (entry === undefined) return release(itemId, DENIED)
    pending.delete(itemId)
    emit({ type: "item.updated", at: Date.now(), item: { ...entry.item, status: "cancelled" } })
    entry.resolve(DENIED)
    return true
  }

  return {
    open: (req) =>
      new Promise<ApprovalAnswer>((resolve) => {
        const item = card(req, "pending")
        pending.set(req.itemId, { resolve, item })
        emit({ type: "item.started", at: req.at, item })
      }),
    resolve: (itemId, answer) => settle(itemId, answer, Date.now()),
    hold,
    cancelApproval,
    openQuestion: (questionId, onSettled) =>
      new Promise<QuestionResponse>((resolve) => {
        questions.set(questionId, { resolve, onSettled })
      }),
    resolveQuestion: settleQuestion,
    cancelQuestion: (questionId) => settleQuestion(questionId, DISMISSED),
    settleTurn: () => {
      for (const itemId of [...pending.keys()]) cancelApproval(itemId)
      for (const questionId of [...questions.keys()]) settleQuestion(questionId, DISMISSED)
    },
    settleAll: () => {
      for (const itemId of [...pending.keys(), ...ids()]) cancelApproval(itemId)
      for (const questionId of [...questions.keys()]) settleQuestion(questionId, DISMISSED)
    },
  }
}
