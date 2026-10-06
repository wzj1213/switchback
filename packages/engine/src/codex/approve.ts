import { decide, type Request as ApprovalRequest, type Rule } from "@switchback/approval"
import type { Trust } from "@switchback/protocol"
import { sanitize } from "../claude/permission.js"
import type { StartRequest } from "../contract.js"
import type { ServerCall } from "../rpc.js"
import { answerElicitation, MCP_ELICITATION } from "./elicitation.js"
import { answerPermissions, PERMISSIONS_APPROVAL } from "./permissions.js"
import { answerUserInput, USER_INPUT_REQUEST } from "./user-input.js"
import type { WireApprovalRequest, WireDecision, WireItem } from "./wire.js"

/**
 * codex 的审批请求 ↔ `@switchback/approval`。
 *
 * **和 Claude 最大的结构差别在这里。** Claude 的 `canUseTool` 把工具名和完整参数
 * 一起递过来，判定所需的一切都在回调里。codex 的审批请求只带一个 `itemId`——
 * 命令、diff、路径全都不在里面，它们在此前那条 `item/started` 通知里。
 *
 * 所以驱动**必须**留着在途 item（见 `driver.ts` 的 `inflight`），否则就只能问用户
 * 「要批准这个吗」而说不出「这个」是什么。这是 Switchback 接第二家引擎发现的第一个真问题。
 */

/** 方法名 → 工具名。这一步不依赖 item，所以即使 item 丢了也能正确归类。 */
const TOOL_BY_METHOD: Readonly<Record<string, string>> = {
  "item/commandExecution/requestApproval": "shell",
  "item/fileChange/requestApproval": "apply_patch",
}

export function toolOf(method: string): string {
  return TOOL_BY_METHOD[method] ?? method
}

function pathsOf(item: WireItem | undefined): readonly string[] {
  return (item?.changes ?? []).map((c) => c.path).filter((p) => p !== "")
}

function networkArgs(params: WireApprovalRequest): Record<string, unknown> {
  const network = params.networkApprovalContext
  return { host: network?.host ?? "", protocol: network?.protocol ?? "" }
}

function shellArgs(params: WireApprovalRequest, item: WireItem | undefined): Record<string, unknown> {
  const args: Record<string, unknown> = { command: params.command ?? item?.command ?? "" }
  if (params.cwd !== undefined && params.cwd !== null) args["cwd"] = params.cwd
  return args
}

function fileArgs(params: WireApprovalRequest, item: WireItem | undefined): Record<string, unknown> {
  const paths = pathsOf(item)
  const args: Record<string, unknown> = { paths }
  if (paths[0] !== undefined) args["path"] = paths[0]
  if (params.grantRoot !== undefined && params.grantRoot !== null) args["grantRoot"] = params.grantRoot
  return args
}

/**
 * 判定用的参数。
 *
 * `paths` 是复数：一个 apply_patch 可以同时改多个文件，只报第一个会让
 * 「写到工作区外」这类红线漏掉后面的路径。`classify` 认这个键。
 */
function argsOf(method: string, params: WireApprovalRequest, item: WireItem | undefined): Record<string, unknown> {
  if (params.networkApprovalContext !== undefined && params.networkApprovalContext !== null) return networkArgs(params)
  return toolOf(method) === "shell" ? shellArgs(params, item) : fileArgs(params, item)
}

const MAX_FILES = 3

function reasonOf(reason: string | null | undefined): string {
  return reason === undefined || reason === null ? "" : ` （${sanitize(reason)}）`
}

function networkSummary(params: WireApprovalRequest): string {
  const network = params.networkApprovalContext
  const target = `${sanitize(network?.protocol ?? "network")}://${sanitize(network?.host ?? "目标未送达")}`
  return `访问网络 ${target}`
}

function shellSummary(params: WireApprovalRequest, item: WireItem | undefined): string {
  const command = params.command ?? item?.command
  return command === undefined ? "执行命令（详情未送达）" : `执行 ${sanitize(command)}`
}

function fileSummary(item: WireItem | undefined): string {
  const paths = pathsOf(item)
  if (paths.length === 0) return "修改文件（详情未送达）"
  const shown = paths.slice(0, MAX_FILES).map((path) => sanitize(path)).join("、")
  const more = paths.length > MAX_FILES ? ` 等 ${String(paths.length)} 个文件` : ""
  return `修改 ${shown}${more}`
}

/**
 * 给人看的一句话。**说不清楚就要说自己说不清楚**——
 * 一张写着「批准吗？」却不说批准什么的卡片，比不弹卡片更糟。
 */
export function summarize(method: string, params: WireApprovalRequest, item: WireItem | undefined): string {
  const reason = reasonOf(params.reason)
  if (params.networkApprovalContext !== undefined && params.networkApprovalContext !== null) {
    return `${networkSummary(params)}${reason}`
  }
  const summary = toolOf(method) === "shell" ? shellSummary(params, item) : fileSummary(item)
  return `${summary}${reason}`
}

export function buildRequest(
  method: string,
  params: WireApprovalRequest,
  item: WireItem | undefined,
  cwd: string,
): ApprovalRequest {
  return {
    engine: "codex",
    tool: params.networkApprovalContext === undefined || params.networkApprovalContext === null
      ? toolOf(method)
      : "network",
    args: argsOf(method, params, item),
    cwd,
    summary: summarize(method, params, item),
  }
}

/**
 * `acceptForSession` 是 codex 侧的「本会话不再问」。勾了记忆就用它——
 * 让 codex 自己记住比 Switchback 每次拦下来再放行省一个来回，
 * 语义也和用户勾选的那句话完全一致。
 */
export function decisionFor(allow: boolean, remember: boolean): WireDecision {
  if (!allow) return "decline"
  return remember ? "acceptForSession" : "accept"
}

/**
 * 一次服务端审批请求怎么答。
 *
 * 从驱动搬过来的：驱动只该管发 RPC 和收通知，**「这一次该不该放行」是审批的事**，
 * 而这个文件本来就是 codex 审批的翻译层。
 */
export interface AnswerDeps {
  /** 在途 item。审批请求只带 itemId，要靠它说清楚在批准什么——见本文件开头。 */
  inflight: Map<string, WireItem>
  cwd: string
  home: string
  /** 取值函数：档位会在会话中途被改。 */
  trust: () => Trust
  /** 同理，记忆规则中途会加。 */
  memory: () => readonly Rule[]
  askUser: StartRequest["askUser"]
  askQuestion: StartRequest["askQuestion"]
  signal?: AbortSignal
}

/** 认领实验面时的 CI 与真正路由共用这个判据。 */
export function handlesServerRequest(method: string): boolean {
  return method === MCP_ELICITATION ||
    method === PERMISSIONS_APPROVAL ||
    method === USER_INPUT_REQUEST ||
    TOOL_BY_METHOD[method] !== undefined
}

/**
 * **必须每一条都答**——不答 codex 会一直等，整轮就此挂住。
 *
 * MCP elicitation 另走它自己的标准响应；其余认不出的请求回 JSON-RPC
 * method-not-found，既不让 codex 无限期等，也不拿空对象冒充成功。
 */
export async function answerApproval(call: ServerCall, deps: AnswerDeps): Promise<void> {
  if (call.method === MCP_ELICITATION) {
    await answerElicitation(call, deps)
    return
  }
  if (call.method === PERMISSIONS_APPROVAL) {
    await answerPermissions(call, deps)
    return
  }
  if (call.method === USER_INPUT_REQUEST) {
    await answerUserInput(call, deps)
    return
  }
  if (TOOL_BY_METHOD[call.method] === undefined) {
    call.reject({ code: -32601, message: `Switchback 未认领 ${call.method}` })
    return
  }
  const params = call.params as WireApprovalRequest
  const item = deps.inflight.get(params.itemId)
  const request = buildRequest(call.method, params, item, deps.cwd)
  const verdict = decide(request, {
    trust: deps.trust(),
    worksite: deps.cwd,
    home: deps.home,
    memory: deps.memory(),
  })
  if (verdict.action !== "escalate") {
    call.respond({ decision: verdict.action === "allow" ? "accept" : "decline" })
    return
  }
  const ask = {
    toolCallId: params.itemId,
    tool: request.tool,
    summary: request.summary ?? toolOf(call.method),
    reason: verdict.reason,
    ...(verdict.redline === undefined ? {} : { redline: verdict.redline }),
    ...(verdict.suggest === undefined ? {} : { rememberHint: verdict.suggest.describe, suggest: verdict.suggest }),
  }
  const answer = deps.signal === undefined
    ? await deps.askUser(ask)
    : await deps.askUser(ask, { signal: deps.signal })
  call.respond({ decision: decisionFor(answer.allow, answer.remember !== "once") })
}
