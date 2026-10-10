/** Kimi Web API 的窄类型。权威定义来自服务端自己的 OpenAPI / AsyncAPI。 */

export type {
  KimiTranscriptEntry,
  KimiTranscriptFrame,
  KimiTranscriptMarker,
  KimiTranscriptPage,
  KimiTranscriptTurn,
} from "./transcript-wire.js"

export interface KimiMeta {
  server_version: string
  capabilities: { websocket?: boolean; file_upload?: boolean }
  dangerous_bypass_auth?: boolean
  backend?: string
}

export interface KimiSessionRow {
  id: string
  title: string
  updated_at?: string | number
  last_prompt?: string
  busy: boolean
  last_turn_reason?: "completed" | "cancelled" | "failed"
  current_prompt_id?: string | null
  metadata: { cwd: string }
  agent_config: { model?: string; thinking?: string }
  usage?: KimiUsage
}

export interface KimiUsage {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  context_tokens: number
  context_limit: number
}

export interface KimiStatus {
  busy: boolean
  model?: string
  thinking_level?: string
  permission?: "manual" | "yolo" | "auto"
  plan_mode?: boolean
  context_tokens?: number
  max_context_tokens?: number
}

export interface KimiGoalSnapshot {
  goalId: string
  objective: string
  completionCriterion?: string
  status: "active" | "paused" | "blocked" | "complete"
  turnsUsed: number
  tokensUsed: number
  wallClockMs: number
  budget: { tokenBudget: number | null }
  terminalReason?: string
}

export interface KimiModel {
  provider: string
  model: string
  display_name?: string
  max_context_size?: number
  capabilities?: readonly string[]
  support_efforts?: readonly string[]
  default_effort?: string
}

export interface KimiSkill {
  name: string
  description?: string
  source?: string
  type?: string
  disable_model_invocation?: boolean
}

export interface KimiPrompt {
  prompt_id: string
  status: "running" | "queued" | "blocked"
}

export interface KimiImageContent {
  type: "image"
  source: { kind: "path"; path: string }
}

export type KimiContent = { type: "text"; text: string } | KimiImageContent

export type KimiToolDisplay =
  | { kind: "command"; command: string; cwd?: string; description?: string }
  | {
      kind: "file_io"
      operation: "read" | "write" | "edit" | "glob" | "grep"
      path: string
      detail?: string
      content?: string
      before?: string
      after?: string
    }
  | { kind: "diff"; path: string; before: string; after: string }
  | { kind: "search"; query: string; scope?: string }
  | { kind: "url_fetch"; url: string; method?: string }
  | { kind: "todo_list"; items: readonly { title: string; status: string }[] }
  | { kind: "generic"; summary: string; detail?: unknown }

export interface KimiApproval {
  approval_id: string
  session_id: string
  turn_id?: number
  tool_call_id: string
  tool_name: string
  action: string
  tool_input_display: KimiToolDisplay | unknown
}

export interface KimiQuestion {
  question_id: string
  session_id: string
  tool_call_id?: string
  questions: readonly {
    id: string
    question: string
    header?: string
    body?: string
    options: readonly { id: string; label: string; description?: string }[]
    multi_select?: boolean
    allow_other?: boolean
    other_label?: string
    other_description?: string
  }[]
}

export interface KimiRunningTool {
  tool_call_id: string
  name: string
  args?: unknown
  description?: string
  display?: KimiToolDisplay
  last_progress?: { kind: string; text?: string }
}

export interface KimiSubagent {
  id: string
  session_id: string
  kind: "subagent" | "bash" | "tool"
  description?: string
  status: "running" | "completed" | "failed" | "cancelled"
  subagent_phase?: "queued" | "working" | "suspended" | "completed" | "failed"
  subagent_type?: string
  parent_tool_call_id?: string
  run_in_background?: boolean
  model?: string
  thinking_effort?: string
  created_at?: string | number
  started_at?: string | number
  completed_at?: string | number
  suspended_reason?: string
  output_preview?: string
  error?: string
}

export interface KimiSessionWarning {
  code: string
  message: string
  severity: "info" | "warning" | "error"
}

export interface KimiWarningsResponse {
  warnings: readonly KimiSessionWarning[]
}

export interface KimiTask {
  id: string
  session_id: string
  kind: "subagent" | "bash" | "tool"
  description: string
  status: "running" | "completed" | "failed" | "cancelled"
  command?: string
  created_at: string | number
  started_at?: string | number
  completed_at?: string | number
  output_preview?: string
}

export interface KimiTasksResponse {
  items: readonly KimiTask[]
}

export interface KimiSnapshot {
  as_of_seq: number
  epoch: string
  session: KimiSessionRow
  in_flight_turn: {
    turn_id: number
    assistant_text: string
    thinking_text: string
    running_tools: readonly KimiRunningTool[]
    current_prompt_id?: string
  } | null
  pending_approvals: readonly KimiApproval[]
  pending_questions: readonly KimiQuestion[]
  subagents?: readonly KimiSubagent[]
}

export interface KimiFrame {
  type: string
  seq?: number
  offset?: number
  epoch?: string
  volatile?: boolean
  timestamp?: string
  session_id?: string
  payload?: KimiPayload
  id?: string
  code?: number
  msg?: string
}

export interface KimiPayload {
  type?: string
  agentId?: string
  sessionId?: string
  turnId?: number
  promptId?: string
  prompt?: string
  origin?: unknown
  step?: number
  reason?: string
  error?: unknown
  interruptReason?: string
  delta?: string
  toolCallId?: string
  name?: string
  argumentsPart?: string
  args?: unknown
  description?: string
  display?: KimiToolDisplay
  update?: { kind?: string; text?: string; percent?: number }
  output?: unknown
  isError?: boolean
  retryable?: boolean
  message?: string
  code?: string
  trigger?: "manual" | "auto" | "user-slash" | "model-tool" | "nested-skill"
  instruction?: string
  result?: KimiCompactionResult
  model?: string
  thinkingEffort?: string
  contextTokens?: number
  maxContextTokens?: number
  permission?: "manual" | "yolo" | "auto"
  planMode?: boolean
  usage?: KimiEventUsage
  finishReason?: string
  providerFinishReason?: "completed" | "tool_calls" | "truncated" | "filtered" | "paused" | "other"
  rawFinishReason?: string
  approval_id?: string
  tool_call_id?: string
  tool_name?: string
  action?: string
  tool_input_display?: unknown
  question_id?: string
  questions?: KimiQuestion["questions"]
  snapshot?: KimiGoalSnapshot | null
  nonce?: string
  [key: string]: unknown
}

export interface KimiCompactionResult {
  summary?: string
  compactedCount?: number
  tokensBefore?: number
  tokensAfter?: number
}

export interface KimiEventUsage {
  total?: { inputOther: number; output: number; inputCacheRead: number; inputCacheCreation: number }
}
