import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk"
import { decide, type Verdict } from "@switchback/approval"
import type { Trust } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import { ASK_USER_QUESTION, askQuestions } from "./ask-question.js"
import { buildRequest, forcedReason, forcesHumanPrompt, summarize, toAllow, toDeny, type AskMeta } from "./permission.js"
import { localeOf } from "../locale.js"
import { CLAUDE_JUDGE } from "./judge.messages.js"

/**
 * `canUseTool` 的实现。管线：红线/档位判定 → 必要时问人。
 *
 * 从 `driver.ts` 拆出来是行数闸门逼的，这一刀也顺：那边是「一条会话怎么活」，
 * 这边只回答「这一次调用放不放、要不要问人」。
 *
 * 注意 `forcesHumanPrompt`：用户自己配的 ask 规则强制的请求，
 * 判定器说 allow 也要问人——见 permission.ts 的注释。
 */
export async function judge(
  deps: { req: StartRequest; trust: () => Trust },
  tool: string,
  input: Record<string, unknown>,
  meta: AskMeta,
): Promise<PermissionResult> {
  const { req } = deps
  // 模型交给人回答的问题走问题卡，答案按 SDK 公开字段交回（见 ask-question.ts）。
  // 问人本身不改任何东西，所以不过判定器、任何档位都问
  if (tool === ASK_USER_QUESTION) {
    return askQuestions(input, meta.toolUseID, req.askQuestion, { signal: meta.signal, locale: localeOf(req) })
  }
  // Plan 的退出本身就是放宽权限。只读档不能把它当普通 meta 工具自动放行。
  if (deps.trust() === "read-only" && tool === "ExitPlanMode") {
    return toDeny(CLAUDE_JUDGE[localeOf(req)].planReadOnly)
  }
  const request = buildRequest(tool, input, meta, { engine: "claude", cwd: req.cwd })
  const verdict = decide(request, { trust: deps.trust(), worksite: req.cwd, home: req.home, memory: req.memory(), locale: localeOf(req) })
  if (verdict.action === "deny") return toDeny(verdict.reason)
  const forced = forcesHumanPrompt(meta)
  if (verdict.action === "allow" && !forced) return toAllow("once", meta)
  return askHuman(req, tool, meta, { verdict, forced })
}

/** 交给人裁决。用户 ask 规则强制的卡照红线对待：「本轮剩下的都放行」不能吞掉它（codex 的 MCP 授权同理）。 */
async function askHuman(
  req: StartRequest,
  tool: string,
  meta: AskMeta,
  why: { verdict: Verdict; forced: boolean },
): Promise<PermissionResult> {
  const { verdict, forced } = why
  const redline = verdict.redline ?? (forced ? "claude-ask-rule" : undefined)
  const answer = await req.askUser({
    toolCallId: meta.toolUseID,
    tool,
    summary: summarize(tool, meta),
    reason: forced && verdict.action === "allow" ? forcedReason(meta, localeOf(req)) : verdict.reason,
    ...(redline === undefined ? {} : { redline }),
    ...(verdict.suggest === undefined ? {} : { rememberHint: verdict.suggest.describe, suggest: verdict.suggest }),
    // 子 agent 里来的请求：照 SDK 给的 id 标出来，不去对旁路猜名字
    ...(meta.agentID === undefined || meta.agentID === "" ? {} : { origin: { kind: "subagent" as const, id: meta.agentID } }),
  }, meta.signal === undefined ? undefined : { signal: meta.signal })
  if (answer.allow) return toAllow(answer.remember, meta, redline !== undefined)
  // 没人能问时照实说：这不是用户的决定，模型据此不该以为用户明确不让做
  const m = CLAUDE_JUDGE[localeOf(req)]
  return toDeny(answer.unattended === true ? m.closed : m.denied)
}
