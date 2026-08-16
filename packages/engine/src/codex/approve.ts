import { decide, type Request as ApprovalRequest, type Rule } from "@omni/approval"
import type { Trust } from "@omni/protocol"
import { sanitize } from "../claude/permission.js"
import type { ApprovalAnswer, ApprovalAsk } from "../contract.js"
import type { ServerCall } from "../rpc.js"
import type { WireApprovalRequest, WireDecision, WireItem } from "./wire.js"

/**
 * codex 的审批请求 ↔ `@omni/approval`。
 *
 * **和 Claude 最大的结构差别在这里。** Claude 的 `canUseTool` 把工具名和完整参数
 * 一起递过来，判定所需的一切都在回调里。codex 的审批请求只带一个 `itemId`——
 * 命令、diff、路径全都不在里面，它们在此前那条 `item/started` 通知里。
 *
 * 所以驱动**必须**留着在途 item（见 `driver.ts` 的 `inflight`），否则就只能问用户
 * 「要批准这个吗」而说不出「这个」是什么。这是 omni 接第二家引擎发现的第一个真问题。
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

/**
 * 判定用的参数。
 *
 * `paths` 是复数：一个 apply_patch 可以同时改多个文件，只报第一个会让
 * 「写到工作区外」这类红线漏掉后面的路径。`classify` 认这个键。
 */
function argsOf(method: string, params: WireApprovalRequest, item: WireItem | undefined): Record<string, unknown> {
  if (toolOf(method) === "shell") {
    const command = params.command ?? item?.command ?? ""
    return { command, ...(params.cwd === undefined || params.cwd === null ? {} : { cwd: params.cwd }) }
  }
  const paths = pathsOf(item)
  return {
    paths,
    ...(paths[0] === undefined ? {} : { path: paths[0] }),
    ...(params.grantRoot === undefined || params.grantRoot === null ? {} : { grantRoot: params.grantRoot }),
  }
}

const MAX_FILES = 3

/**
 * 给人看的一句话。**说不清楚就要说自己说不清楚**——
 * 一张写着「批准吗？」却不说批准什么的卡片，比不弹卡片更糟。
 */
export function summarize(method: string, params: WireApprovalRequest, item: WireItem | undefined): string {
  const reason = params.reason === undefined || params.reason === null ? "" : ` （${sanitize(params.reason)}）`
  if (toolOf(method) === "shell") {
    const command = params.command ?? item?.command
    return command === undefined
      ? `执行命令（详情未送达）${reason}`
      : `执行 ${sanitize(command)}${reason}`
  }
  const paths = pathsOf(item)
  if (paths.length === 0) return `修改文件（详情未送达）${reason}`
  const shown = paths.slice(0, MAX_FILES).map((p) => sanitize(p)).join("、")
  const more = paths.length > MAX_FILES ? ` 等 ${String(paths.length)} 个文件` : ""
  return `修改 ${shown}${more}${reason}`
}

export function buildRequest(
  method: string,
  params: WireApprovalRequest,
  item: WireItem | undefined,
  cwd: string,
): ApprovalRequest {
  return {
    engine: "codex",
    tool: toolOf(method),
    args: argsOf(method, params, item),
    cwd,
    summary: summarize(method, params, item),
  }
}

/**
 * `acceptForSession` 是 codex 侧的「本会话不再问」。勾了记忆就用它——
 * 让 codex 自己记住比 omni 每次拦下来再放行省一个来回，
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
  askUser: (ask: ApprovalAsk) => Promise<ApprovalAnswer>
}

/**
 * **必须每一条都答**——不答 codex 会一直等，整轮就此挂住。
 *
 * 认不出的请求一律回空对象：宁可让 codex 拿到一个它看不懂的应答，
 * 也不能让它无限期等下去。审批类的认不出就拒——默认拒是唯一安全的默认。
 */
export async function answerApproval(call: ServerCall, deps: AnswerDeps): Promise<void> {
    if (!call.method.endsWith("requestApproval")) {
      call.respond({})
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
    const answer = await deps.askUser({
      toolCallId: params.itemId,
      tool: toolOf(call.method),
      summary: request.summary ?? toolOf(call.method),
      reason: verdict.reason,
      ...(verdict.suggest === undefined ? {} : { rememberHint: verdict.suggest.describe, suggest: verdict.suggest }),
    })
    call.respond({ decision: decisionFor(answer.allow, answer.remember !== "once") })
}
