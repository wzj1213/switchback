import type {
  Options, UserDialogRequest, UserDialogResult,
} from "@anthropic-ai/claude-agent-sdk"
import type { ItemId, QuestionPrompt, QuestionResponse, ToolCallItem } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import type { PlanState } from "./plan.js"
import { sanitize } from "./permission.js"
import { retractMessages, type RetractionState } from "./retraction.js"

const DIALOG_KIND = "refusal_fallback_prompt"
const QUESTION_ID = "claude-refusal-fallback"
const CANCELLED: UserDialogResult = { behavior: "cancelled" }

interface Payload {
  originalModel: string
  fallbackModel: string
  guidanceText?: string
  retractedMessageUuids: readonly string[]
}

function requiredText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function uuidList(value: unknown): readonly string[] | undefined {
  if (value === undefined) return []
  return Array.isArray(value) && value.every((id) => typeof id === "string") ? value : undefined
}

function payloadOf(request: UserDialogRequest): Payload | undefined {
  if (request.dialogKind !== DIALOG_KIND) return undefined
  const { originalModel, fallbackModel, guidanceText, retractedMessageUuids } = request.payload
  const original = requiredText(originalModel)
  const fallback = requiredText(fallbackModel)
  const retracted = uuidList(retractedMessageUuids)
  if (original === undefined || fallback === undefined || retracted === undefined) return undefined
  if (guidanceText !== undefined && typeof guidanceText !== "string") return undefined
  return {
    originalModel: original,
    fallbackModel: fallback,
    ...(guidanceText === undefined ? {} : { guidanceText }),
    retractedMessageUuids: retracted,
  }
}

function promptOf(payload: Payload): QuestionPrompt {
  const original = sanitize(payload.originalModel)
  const fallback = sanitize(payload.fallbackModel)
  const guidance = payload.guidanceText === undefined ? "" : sanitize(payload.guidanceText)
  return {
    id: QUESTION_ID,
    header: "Claude · 会话已暂停",
    question: "这次请求被原模型拒绝，接下来怎么做？",
    ...(guidance === "" ? {} : { body: guidance }),
    options: [
      { id: "retry_fallback", label: `切换到 ${fallback}`, description: "用备用模型重试当前请求" },
      {
        id: "edit_prompt",
        label: `修改后继续用 ${original}`,
        description: "结束当前轮；在输入框修改后重新发送",
      },
    ],
  }
}

function choiceOf(response: QuestionResponse): "retry_fallback" | "edit_prompt" | "cancelled" {
  if ("dismissed" in response) return "cancelled"
  const answer = response.answers[QUESTION_ID]
  if (answer?.kind !== "single") return "cancelled"
  return answer.optionId === "retry_fallback" || answer.optionId === "edit_prompt"
    ? answer.optionId
    : "cancelled"
}

type AskQuestion = StartRequest["askQuestion"]

/** 回答原生拒答对话；撤回只在用户选择/取消落定之后发生，中止轮次则保留现场。 */
export async function answerRefusalDialog(
  request: UserDialogRequest,
  askQuestion: AskQuestion,
  signal: AbortSignal,
  resolved: (uuids: readonly string[]) => void,
): Promise<UserDialogResult> {
  const payload = payloadOf(request)
  if (payload === undefined || signal.aborted) return CANCELLED
  let response: QuestionResponse
  try {
    response = await askQuestion([promptOf(payload)], { signal })
  } catch {
    if (signal.aborted) return CANCELLED
    response = { dismissed: true }
  }
  if (signal.aborted) return CANCELLED
  resolved(payload.retractedMessageUuids)
  return { behavior: "completed", result: choiceOf(response) }
}

interface DialogTurn {
  retractions: RetractionState
  tools: Map<ItemId, ToolCallItem>
  plan: PlanState
}

/** 只声明两端真实可渲染的 kind；未知新 kind 继续由 SDK fail closed。 */
export function refusalDialogOptions(
  req: Pick<StartRequest, "askQuestion" | "emit">,
  turn: DialogTurn,
): Pick<Options, "onUserDialog" | "supportedDialogKinds"> {
  return {
    supportedDialogKinds: [DIALOG_KIND],
    onUserDialog: (request, { signal }) => answerRefusalDialog(
      request,
      req.askQuestion,
      signal,
      (uuids) => retractMessages(turn.retractions, uuids, {
        at: Date.now(), emit: req.emit, tools: turn.tools, plan: turn.plan,
      }),
    ),
  }
}
