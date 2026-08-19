import { access, readdir } from "node:fs/promises"
import { join } from "node:path"
import type { Trust } from "@omni/protocol"

/**
 * grok 的会话记录在磁盘上的哪儿。
 *
 * 和 `kimi.ts` 同一个位置、同一个理由：ACP 协议里**没有「记录在哪」这个概念**，
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
 * grok 的原生审批开关。
 *
 * ## 不传它 = 一路放行，而且一声不响
 *
 * 实测两组对照（同一个提示词，让它改一个文件）：
 *
 * | `session/new` 的 `_meta` | 会话的 yolo 标记 | 审批请求 | 文件 |
 * | --- | --- | --- | --- |
 * | 不给 | **true** | **0 次** | 被改了 |
 * | `{yoloMode:false}` | false | 1 次（带 `kind` 和完整命令） | 拒掉后没变 |
 *
 * 也就是说 **grok 的 ACP 会话默认就是 yolo**：不传这一条，omni 的三档对它
 * 完全没有发言权——用户选「只读」，它照样改文件。这不是体验问题，是安全洞。
 *
 * ## 为什么只能是两档
 *
 * grok 的 TUI 有六个档（`acceptEdits`/`auto`/`dontAsk`/`bypassPermissions`…），
 * 但**ACP 上一个都没暴露**：`session/set_mode` 是空壳（连不存在的档位也回 `{}`），
 * 唯一的开关就是这个 `yoloMode`。所以它没有 kimi 那种「安全操作自动放行」的中间档，
 * 只有「全问」和「全不问」。
 *
 * 映射：**只读档要真只读**，所以关掉 yolo，让它来问、由 omni 按只读档拒；
 * 自动编辑与完全档保持它原生的不打扰，并且**把这件事说出来**——
 * 那一档下 omni 的判定与红线对它确实不生效，闷着不说才是骗人。
 *
 * ## 只在开会话时生效
 *
 * 它在 `session/new` 里，和 codex 的 OS 沙箱一样**开完就定死**。
 * 中途换档改不了，那时驱动发一条 `degraded`——不假装改成了。
 */
export function grokNativeApproval(trust: Trust): {
  meta: Readonly<Record<string, unknown>>
  note?: string
} {
  const yolo = trust !== "read-only"
  if (!yolo) return { meta: { yoloMode: false } }
  return {
    meta: { yoloMode: true },
    note:
      "Grok 在这一档下自动放行一切工具调用——它的 ACP 只有「全问 / 全不问」两档，" +
      "没有「安全操作自动放行」。omni 的判定与红线对它因此不生效；" +
      "要真正限制它，用只读档，或者 grok 自己的沙箱（`grok --sandbox` / `~/.grok/config.toml`）。",
  }
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
 * 而**算错的代价不是报错，是悄悄退回交接包**——用户不会知道自己本可以拿到全量原文。
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
