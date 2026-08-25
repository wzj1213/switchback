import type { RawStreamEvent } from "./stream.js"
import type { RawUsage } from "./usage.js"

/** SDK 消息的结构性最小类型——只声明消息循环真正读取的字段。 */
export interface RawLoopMessage {
  type: string
  event?: RawStreamEvent
  subtype?: string
  is_error?: boolean
  message?: { content?: unknown; model?: unknown; usage?: RawUsage }
  /** null 是主 agent；字符串是 Task 子 agent 的旁路，不能混进主 transcript。 */
  parent_tool_use_id?: string | null
  usage?: RawUsage
  content?: unknown
  level?: unknown
  tool_use_id?: unknown
  task_id?: unknown
  rate_limit_info?: unknown
  result?: unknown
  errors?: unknown
  commands?: unknown
  mcp_servers?: unknown
  terminal_slash_commands?: unknown
  attempt?: unknown
  max_retries?: unknown
  retry_delay_ms?: unknown
  error_status?: unknown
  error?: unknown
  name?: unknown
  mcp_server_name?: unknown
  elicitation_id?: unknown
  status?: unknown
  compact_result?: unknown
  compact_error?: unknown
  compact_metadata?: unknown
  estimated_tokens?: unknown
  session_id?: string
  new_conversation_id?: unknown
  permissionMode?: string
  uuid?: unknown
  supersedes?: unknown
  direction?: unknown
  scope?: unknown
  original_model?: unknown
  fallback_model?: unknown
  retracted_message_uuids?: unknown
  hook_id?: unknown
  hook_name?: unknown
  hook_event?: unknown
  stdout?: unknown
  stderr?: unknown
  output?: unknown
  exit_code?: unknown
  outcome?: unknown
  permission_denials?: unknown
  key?: unknown
  text?: unknown
  priority?: unknown
  color?: unknown
  timeout_ms?: unknown
}
