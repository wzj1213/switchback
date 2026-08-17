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
  /** 等详情补齐最多等多久（毫秒）。默认 `DETAIL_WAIT_MS`；测试传 0 就不等。 */
  waitMs?: number
}

/**
 * 等在途表把详情补齐要给多少时间。
 *
 * 实测 kimi 的顺序是：`tool_call`（有 kind、没命令）→ `request_permission`
 * （没 kind、没命令）→ **批准之后** `tool_call_update {rawInput:{command}}`——
 * 而最后那条只比审批请求晚 **2 毫秒**。300ms 是它的一百多倍余量。
 *
 * 上限存在的意义是「等不到也别挂着」：那时命令留空，判定器按「看不见」办
 * （落 `unknown`：只读档安静拒掉、自动编辑档问一次），而不是拿标题冒充命令。
 */
const DETAIL_WAIT_MS = 300
const DETAIL_POLL_MS = 10

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 判定要用的东西到了没。`rawInput` 带命令，`content`/`locations` 带 diff 与路径。 */
function hasDetails(call: AcpToolCall): boolean {
  return call.rawInput !== undefined || call.content !== undefined || call.locations !== undefined
}

/**
 * 把审批请求和在途表合起来，**必要时等一下**。
 *
 * 审批请求本身只是一个「指回那条工具调用」的引用（实测 kimi 只给
 * `{toolCallId, title, content}`，连 `kind` 都没有），所以先合并；
 * 合完还看不见详情就等——那 8 条靠命令原文的红线全指望这一步。
 *
 * **不用 `merge`**：那个函数把 `null` 当「显式清空」（`tool_call_update` 是补丁语义），
 * 而审批请求不是补丁，它是引用；照补丁语义合会把已知的 `kind` 清掉。
 */
async function withDetails(
  ctx: PermissionContext,
  id: string | undefined,
  patch: AcpToolCall,
  ): Promise<AcpToolCall> {
  const budget = ctx.waitMs ?? DETAIL_WAIT_MS
  const join = (): AcpToolCall => ({ ...ctx.inflight.get(id ?? ""), ...patch })
  if (id === undefined) return join()
  for (let waited = 0; waited < budget; waited += DETAIL_POLL_MS) {
    if (hasDetails(join())) break
    await sleep(DETAIL_POLL_MS)
  }
  return join()
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
 * 请求体里**只有 toolCallId（连 kind 都未必有）**——标题、命令、diff 全都不在，
 * 它们在别的 `session/update` 里。所以先查在途表补齐，**必要时等一下**
 * （见 `withDetails`：命令原文实测只比审批请求晚 2ms），再送去判定。
 *
 * 等不到也照样判，但**判的是「看不见」而不是「无害」**：命令留空之后
 * 判定器落 `unknown`（只读档安静拒掉、自动编辑档问一次），
 * 而 `buildRequest` 的摘要退化成一句「详情未送达」，由用户拿主意——
 * 绝不替他默默放行。
 */
export async function handlePermission(ctx: PermissionContext, call: ServerCall): Promise<void> {
  const params = call.params as AcpPermissionRequest
  const id = params.toolCall?.toolCallId
  const merged = await withDetails(ctx, id, params.toolCall ?? {})
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
