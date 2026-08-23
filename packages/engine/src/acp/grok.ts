import { access, readdir } from "node:fs/promises"
import { join } from "node:path"
import type { Trust } from "@omni/protocol"

/**
 * grok 的会话记录在磁盘上的哪儿。
 *
 * 和 Kimi 的日志定位同一个理由：ACP 协议里**没有「记录在哪」这个概念**，
 * 各家往哪写只能一家一家去认，驱动那一层不该认识任何一家的目录结构。
 *
 * ## 和 kimi 相反：这条路是算得出来的
 *
 * kimi 的工作区目录名是它自己算的哈希（`wd_omni_0123456789ab`），猜不出来，
 * 只能查它自己的索引。grok 不用：**目录名就是工作区绝对路径按 URL 编码**，
 * 里面那层目录名就是 ACP 报上来的 sessionId，一字不差——
 *
 * ```
 * ~/.grok/sessions/%2FUsers%2Fyou%2Fwork%2Fomni/01a00e5e-2fea-…/chat_history.jsonl
 * ```
 *
 * 实测立得住：拿一个全新的临时目录开一条 ACP 会话，`session/new` 回的 sessionId
 * 与磁盘上新出现的那个目录同名，目录里的 `summary.json` 也报着同一个 id、同一个 cwd。
 *
 * ## 为什么交接的是 `chat_history.jsonl`
 *
 * 一个会话目录里有好几份记录：`events.jsonl`（引擎自己的事件流）、`updates.jsonl`
 * （ACP 更新流，只有走过 TUI 的会话才有）、`summary.json`（一句概要）、
 * `system_prompt.txt`。只有 `chat_history.jsonl` 是**和模型之间的全部往来**——
 * 系统提示加每一轮的原文，和 kimi 那边交接的 `wire.jsonl` 是同一类东西。
 * 交接要给的是「全量原文」，给概要就退回成摘要了，那正是这条路要绕开的东西。
 */

/**
 * Grok 1.0.5 的 ACP 原生审批档。
 *
 * 当前官方 Agent Mode 文档公开了两枚 `session/new` 扩展位：`autoMode` 启用
 * 分类器评审，`yoloMode` 启用 Always-approve，且后者优先。真机 debug 也明确记录
 * `Wired live LLM permission auto-mode classifier` 与 `auto permission mode set to: true`。
 * 旧实现只认识 yolo，于是把中间档和最高档都接成了一路放行。
 *
 * 两枚值都显式传，避免继承一个与用户所选档位相反的会话默认值。它们也被
 * `session/load` 接收，所以换档时宿主可以保留同一个原生句柄续接重启。
 */
export function grokNativeApproval(trust: Trust): {
  meta: Readonly<Record<string, unknown>>
} {
  if (trust === "read-only") return { meta: { yoloMode: false, autoMode: false } }
  if (trust === "auto-edit") return { meta: { yoloMode: false, autoMode: true } }
  return { meta: { yoloMode: true, autoMode: false } }
}

/** grok 把「和模型之间的全部往来」原样写在这个文件里。 */
const CHAT = "chat_history.jsonl"

/**
 * grok 的上下文用量。
 *
 * ## 为什么不走 ACP 的 `usage_update`
 *
 * 因为它一条都不发。实测跑完整一轮：kimi 收工推一条
 * `usage_update {used, size}`，grok **零条**——它把 token 数放在自己的
 * `_x.ai/session_notification` 里：
 *
 * ```json
 * {"update":{"sessionUpdate":"turn_completed",
 *            "usage":{"inputTokens":15605,"outputTokens":33,"totalTokens":15638,…}}}
 * ```
 *
 * ## 为什么取 `totalTokens`，以及为什么它不是「累计账单」
 *
 * 实测 `totalTokens === inputTokens + outputTokens`（15605+33=15638），
 * 而 `cachedReadTokens` 是 `inputTokens` 的**子集**（否则 total 会更大）。
 * 也就是说这个数正是「这一轮送上去的 + 产出的」= **当前占了多少上下文**，
 * 和 codex 那边在 `last` / `total` 之间挑的是同一个语义。
 * 下一轮历史更长，这个数自然跟着涨——这才是要画进比例条的量。
 *
 * **缓存命中必须算在里面**（和 Claude 驱动同一条注释）：它省的是钱，不是上下文。
 *
 * 只认 `turn_completed`：`response_completed` 报的是单次模型调用（一轮里可能好几次），
 * 拿它去画会在一轮内反复跳。
 */
export function grokContextUsed(method: string, params: unknown): number | undefined {
  if (method !== "_x.ai/session_notification") return undefined
  const update = (params as { update?: { sessionUpdate?: string; usage?: { totalTokens?: unknown } } } | undefined)
    ?.update
  if (update?.sessionUpdate !== "turn_completed") return undefined
  const total = update.usage?.totalTokens
  return typeof total === "number" && total > 0 ? total : undefined
}

/**
 * 同一条 `turn_completed` 里的缓存命中。`cachedReadTokens` 是 `inputTokens` 的子集——
 * 它省的是钱不是上下文（已含在上面那个 total 里）。字段缺席就是没报，不拿 0 冒充。
 */
export function grokCacheRead(method: string, params: unknown): number | undefined {
  if (method !== "_x.ai/session_notification") return undefined
  const update = (
    params as { update?: { sessionUpdate?: string; usage?: { cachedReadTokens?: unknown } } } | undefined
  )?.update
  if (update?.sessionUpdate !== "turn_completed") return undefined
  const hit = update.usage?.cachedReadTokens
  return typeof hit === "number" && hit > 0 ? hit : undefined
}

/** 记录根目录。 */
function root(home: string): string {
  return join(home, ".grok", "sessions")
}

/**
 * 工作区绝对路径 → 目录名。
 *
 * 编码规则是从这台机器上已有的目录**反解**出来的：每一个都能用
 * `encodeURIComponent` 原样还原回去（`/` → `%2F`，而 `-` 保持原样，
 * 这一条排除了「所有非字母数字都编码」那种规则）。
 */
export function grokWorkspaceDir(cwd: string): string {
  return encodeURIComponent(cwd)
}

/** 算出来的那条路径。**存不存在这里不管**，由 `grokLogPath` 去看。 */
export function grokChatPath(home: string, cwd: string, sessionId: string): string {
  return join(root(home), grokWorkspaceDir(cwd), sessionId, CHAT)
}

const readable = (path: string): Promise<boolean> => access(path).then(() => true, () => false)

/**
 * @param home 用户 home 绝对路径。由 `StartRequest.home` 传进来，不读环境变量——
 *   和 `kimi.ts` 同一个理由：读环境的东西没法在测试里摆布。
 * @param cwd 工作区绝对路径。grok 的记录**按工作区分目录**，光有 sessionId 定位不到。
 *
 * ## 算得出来为什么还要再扫一遍
 *
 * 上面那条编码规则是我们用 `encodeURIComponent` 去对 grok（Rust 那边）的编码器，
 * 在实测过的 ASCII 路径上对得上，换一条带中文或空格的路径就未必。
 * 而**算错的代价不是报错，是时间线上悄悄少掉全量原文入口**。
 * 所以算不中就按 sessionId 把 `sessions/` 扫一遍（几十个目录，一次 readdir），
 * 扫不着才给 undefined。
 */
export async function grokLogPath(home: string, sessionId: string, cwd: string): Promise<string | undefined> {
  const direct = grokChatPath(home, cwd, sessionId)
  if (await readable(direct)) return direct
  const dirs = await readdir(root(home)).catch(() => [])
  for (const dir of dirs) {
    const path = join(root(home), dir, sessionId, CHAT)
    if (await readable(path)) return path
  }
  return undefined
}

/**
 * grok 报「模型 / 强度换了」的那条私有通知。**实测原文**：
 *
 * ```json
 * { "method": "_x.ai/session_notification",
 *   "params": { "update": { "sessionUpdate": "model_changed",
 *                           "model_id": "grok-4.6", "reasoning_effort": "xhigh" } } }
 * ```
 *
 * 为什么要接：**你在 grok 自己的界面里改了强度，omni 靠这条才跟得上**。
 * 不接的话选择器停在旧值——和今天修掉的那一族「界面显示的和引擎在跑的分家」是同一件事。
 *
 * 顺带：omni 自己发 `session/set_model` 之后 grok 也会回这一条（实测），
 * 所以它同时是一次「真的设进去了」的确认。
 */
export function grokModelChanged(
  method: string,
  params: unknown,
): { model?: string; effort?: string } | undefined {
  if (method !== "_x.ai/session_notification") return undefined
  const update = (params as { update?: Record<string, unknown> } | undefined)?.update
  if (update?.["sessionUpdate"] !== "model_changed") return undefined
  const model = update["model_id"]
  const effort = update["reasoning_effort"]
  const out = {
    ...(typeof model === "string" && model !== "" ? { model } : {}),
    ...(typeof effort === "string" && effort !== "" ? { effort } : {}),
  }
  // 两样都没认出来就当这条与模型无关——**不报一个空的变更**
  return Object.keys(out).length === 0 ? undefined : out
}
