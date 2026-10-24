import type { ApprovalAnswer, ApprovalAsk, StartRequest } from "../contract.js"
import type { ServerCall } from "../rpc.js"
import { sanitize } from "../claude/permission.js"
import type {
  WireElicitationMeta,
  WireMcpElicitation,
  WireMcpElicitationResponse,
} from "./wire.js"
import { localeOf } from "../locale.js"
import type { Locale } from "@switchback/i18n"
import { CODEX_ELICITATION } from "./elicitation.messages.js"

export const MCP_ELICITATION = "mcpServer/elicitation/request"

export interface ElicitationDeps {
  askUser: StartRequest["askUser"]
  signal?: AbortSignal
  /** 适配器自己写的话用哪种语言（`StartRequest.locale`）。缺省中文。 */
  locale?: () => Locale
}

type Text = (typeof CODEX_ELICITATION)[Locale]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Switchback 目前只有二元审批卡；需要用户填写字段的表单不能假装已经填好。 */
function isBinaryApproval(params: WireMcpElicitation): boolean {
  if (params._meta?.codex_approval_kind !== "mcp_tool_call") return false
  if (params.mode !== "form" && params.mode !== "openai/form") return false
  if (!isRecord(params.requestedSchema) || params.requestedSchema["type"] !== "object") return false
  const required = params.requestedSchema["required"]
  if (Array.isArray(required) && required.length > 0) return false
  const properties = params.requestedSchema["properties"]
  return properties === undefined || (isRecord(properties) && Object.keys(properties).length === 0)
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "string") return sanitize(value)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return undefined
}

function detailsOf(meta: WireElicitationMeta | null | undefined, m: Text): string {
  const rows = (meta?.tool_params_display ?? [])
    .map((row) => {
      const name = textOf(row.display_name) ?? textOf(row.name)
      const value = textOf(row.value)
      return name === undefined || value === undefined ? undefined : m.field(name, value)
    })
    .filter((row): row is string => row !== undefined)
  return m.fields(rows)
}

function supports(meta: WireElicitationMeta | null | undefined, scope: string): boolean {
  return meta?.persist?.includes(scope) === true
}

function connectorOf(params: WireMcpElicitation): string {
  return textOf(params._meta?.connector_name) ?? textOf(params.serverName) ?? "MCP"
}

function reasonOf(params: WireMcpElicitation, connector: string, details: string, m: Text): string {
  const subtitle = textOf(params._meta?.subtitle)
  if (subtitle !== undefined) return subtitle
  return m.wantsTool(connector, textOf(params._meta?.tool_name) ?? m.toolCall, details)
}

function rememberHintOf(meta: WireElicitationMeta | null | undefined, connector: string, details: string): string | undefined {
  if (!supports(meta, "always")) return undefined
  return `${connector}${details === "" ? "" : ` · ${details}`}`
}

function requestFor(call: ServerCall, params: WireMcpElicitation, m: Text): ApprovalAsk {
  const meta = params._meta
  const connector = connectorOf(params)
  const details = detailsOf(meta, m)
  const rememberHint = rememberHintOf(meta, connector, details)
  return {
    toolCallId: textOf(meta?.tool_call_id) ?? `mcp-elicitation-${String(call.id)}`,
    tool: connector,
    summary: textOf(params.message) ?? m.wantsAuth(connector),
    reason: reasonOf(params, connector, details, m),
    // 引擎明确发的是人工授权请求，不能被「本轮剩下的都放行」吞掉。
    // 这一栏只看有没有（不显示），写成一个标识就够
    redline: "mcp-elicitation",
    ...(rememberHint === undefined ? {} : { rememberHint }),
  }
}

/** 用户选的范围 → app-server 的原生持久化字段。 */
export function elicitationResponse(
  answer: ApprovalAnswer,
  meta: WireElicitationMeta | null | undefined,
): WireMcpElicitationResponse {
  if (!answer.allow) return { action: "decline", content: null, _meta: null }
  if (answer.remember === "project" && supports(meta, "always")) {
    return { action: "accept", content: {}, _meta: { persist: "always" } }
  }
  if (answer.remember === "session" && supports(meta, "session")) {
    return { action: "accept", content: {}, _meta: { persist: "session" } }
  }
  return { action: "accept", content: {}, _meta: null }
}

/**
 * Computer Use 的应用授权从这条路进来。无法表达的表单明确 cancel，
 * 不能回 `{}`：那既不是协议里的动作，也会让工具把它误解成莫名其妙的拒绝。
 */
export async function answerElicitation(call: ServerCall, deps: ElicitationDeps): Promise<void> {
  const params = call.params as WireMcpElicitation
  if (!isBinaryApproval(params)) {
    call.respond({ action: "cancel", content: null, _meta: null } satisfies WireMcpElicitationResponse)
    return
  }
  const ask = requestFor(call, params, CODEX_ELICITATION[localeOf(deps)])
  const answer = deps.signal === undefined
    ? await deps.askUser(ask)
    : await deps.askUser(ask, { signal: deps.signal })
  call.respond(elicitationResponse(answer, params._meta))
}
