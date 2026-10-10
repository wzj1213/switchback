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
  /** 引擎已经撤销请求；解开 promise，但不把「过期」冒充成用户拒绝。 */
  cancelApproval: (itemId: ItemId) => boolean
  cancelQuestion: (questionId: QuestionId) => boolean
  /**
   * 把还挂着的一律收掉：给引擎的答复是拒绝，卡片记成「已失效」。
   * 会话关闭时必须调用——否则驱动会永远等在 `canUseTool` 里，`dispose()` 挂死。
   *
   * 调它的全是**不是用户点的**收口（轮次收工、按停止、换引擎、改档重启、关会话），
   * 所以不能记成「已拒绝」：那会让一次中断在回放里读起来像「用户明确拒绝了这次调用」。
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
  }
}

export function createGate(emit: (event: Event) => void): Gate {
  const pending = new Map<ItemId, Pending>()
  const questions = new Map<QuestionId, PendingQuestion>()

  const settle = (itemId: ItemId, answer: ApprovalAnswer, at: number): boolean => {
    const entry = pending.get(itemId)
    if (entry === undefined) return false
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
    if (entry === undefined) return false
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
    cancelApproval,
    openQuestion: (questionId, onSettled) =>
      new Promise<QuestionResponse>((resolve) => {
        questions.set(questionId, { resolve, onSettled })
      }),
    resolveQuestion: settleQuestion,
    cancelQuestion: (questionId) => settleQuestion(questionId, DISMISSED),
    settleAll: () => {
      for (const itemId of [...pending.keys()]) cancelApproval(itemId)
      for (const questionId of [...questions.keys()]) settleQuestion(questionId, DISMISSED)
    },
  }
}
