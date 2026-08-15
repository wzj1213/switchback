import { decide } from "@omni/approval"
import type { RememberScope, Trust } from "@omni/protocol"
import type { ApprovalAnswer, ApprovalAsk } from "../contract.js"
import type { ServerCall } from "../rpc.js"
import type { Rule } from "@omni/approval"
import { buildRequest, pickOption } from "./approve.js"
import type { AcpPermissionOption, AcpPermissionRequest, AcpToolCall } from "./wire.js"

/**
 * 审批的判定与应答。
 *
 * 做成模块级函数 + 显式 ctx，而不是 `AcpSession` 的私有方法：这样**不用起进程
 * 就能测**。审批是整个驱动里唯一「判错了会有真实后果」的一段，
 * 它必须能在没装任何 ACP agent 的机器上跑全套用例。
 */
export interface PermissionContext {
  engine: string
  cwd: string
  home: string
  trust: () => Trust
  memory: () => readonly Rule[]
  /** 在途工具调用表。审批请求只带 id，命令和 diff 全在这里。 */
  inflight: Map<string, AcpToolCall>
  askUser: (ask: ApprovalAsk) => Promise<ApprovalAnswer>
}

/**
 * 挑一个选项回过去。
 *
 * 挑不到**同极性**的选项时回 `cancelled`。这是唯一诚实的出路：
 * `selected` 必须带一个真实的 optionId，而把「拒绝」降级成 allow 是绝不能做的。
 * `cancelled` 的语义是「这次没决定，别做」——正好是我们想要的效果。
 */
export function respond(
  call: ServerCall,
  options: readonly AcpPermissionOption[],
  allow: boolean,
  remember: RememberScope,
): void {
  const optionId = pickOption(options, allow, remember)
  if (optionId === undefined) {
    call.respond({ outcome: { outcome: "cancelled" } })
    return
  }
  call.respond({ outcome: { outcome: "selected", optionId } })
}

/**
 * 判一条 `session/request_permission`。
 *
 * 请求体里**只有 toolCallId、kind、status**——标题、命令、diff 全都不在，
 * 它们在此前那条 `session/update` 里。所以先查在途表补齐，再送去判定。
 * 查不到也照样判：`buildRequest` 会退化成一句「详情未送达」，
 * 由用户拿主意——而不是替他默默放行。
 */
export async function handlePermission(ctx: PermissionContext, call: ServerCall): Promise<void> {
  const params = call.params as AcpPermissionRequest
  const id = params.toolCall?.toolCallId
  const known = id === undefined ? undefined : ctx.inflight.get(id)
  const merged: AcpToolCall = { ...known, ...params.toolCall }
  const request = buildRequest(ctx.engine, merged, ctx.cwd)
  const verdict = decide(request, {
    trust: ctx.trust(),
    worksite: ctx.cwd,
    home: ctx.home,
    memory: ctx.memory(),
  })
  const options = params.options ?? []
  if (verdict.action !== "escalate") {
    respond(call, options, verdict.action === "allow", "once")
    return
  }
  const answer = await ctx.askUser({
    toolCallId: id ?? "",
    tool: request.tool,
    summary: request.summary ?? request.tool,
    reason: verdict.reason,
    ...(verdict.suggest === undefined
      ? {}
      : { rememberHint: verdict.suggest.describe, suggest: verdict.suggest }),
  })
  respond(call, options, answer.allow, answer.remember)
}
