import type { Command, RememberScope, ThreadId } from "@omni/protocol"
import type { ApprovalAnswer, ApprovalAsk } from "@omni/engine"
import type { Rule } from "@omni/approval"
import { setStatus, type Ctx, type Live } from "./ctx.js"

/**
 * 审批：问人、记住答案、落定。
 *
 * 「记住」这件事的三处语义都在这里：session 只进内存、project 要写盘、
 * 拒绝一律不记。
 */

const DENIED: ApprovalAnswer = { allow: false, remember: "once" }

export async function askUser(ctx: Ctx, id: ThreadId, ask: ApprovalAsk): Promise<ApprovalAnswer> {
  const entry = ctx.live.get(id)
  // 会话已关闭却还有审批请求进来：按拒绝落定，不能让驱动永远等着
  if (entry === undefined || entry.turn === undefined) return DENIED
  setStatus(ctx, entry, "waiting_approval")
  const itemId = ctx.deps.newId("ap")
  // 记下建议规则：用户勾了记忆之后，要存的是**规则本身**，
  // 而 `approval.resolve` 命令只带 itemId 回来
  if (ask.suggest !== undefined) entry.suggests.set(itemId, ask.suggest)
  try {
    return await entry.gate.open({ ask, turnId: entry.turn, at: ctx.deps.now(), itemId })
  } finally {
    entry.suggests.delete(itemId)
    // 无论批还是拒都回到运行中——轮次还没结束，引擎接着往下跑
    if (entry.thread.status === "waiting_approval") setStatus(ctx, entry, "running")
  }
}


/**
 * 把一次「记住」落到该落的地方。
 *
 * `session` 只进内存表——它的语义就是「这个会话内不再问」，
 * 落盘反而会让下次启动莫名其妙地少了几次询问。
 * `project` 两边都要：进内存表（立刻生效）＋ 写盘（下次还在）。
 */
export function remember(ctx: Ctx, entry: Live, rule: Rule, scope: RememberScope): void {
  if (scope === "once") return
  const stored: Rule = { ...rule, scope: scope === "project" ? "project" : "session" }
  entry.rules = [...entry.rules.filter((r) => r.id !== stored.id), stored]
  // 展开成新字面量再交出去：`RulePattern` 是 interface，没有索引签名，
  // 直接传给 `Record<string, unknown>` 过不了类型检查
  if (scope === "project") {
    void ctx.deps.rules?.add(entry.thread.cwd, { ...stored, pattern: { ...stored.pattern } })
  }
}

/** 审批卡 id 全局唯一，所以挨个会话问一遍即可；命中就停。 */
export function resolveApproval(ctx: Ctx, cmd: Extract<Command, { type: "approval.resolve" }>): void {
  for (const entry of ctx.live.values()) {
    const suggest = entry.suggests.get(cmd.itemId)
    // 范围原样往下传：以前这里压成 boolean，engine 就再也分不出
    // 「这一次」和「这轮对话」了
    const hit = entry.gate.resolve(cmd.itemId, { allow: cmd.allow, remember: cmd.remember })
    if (!hit) continue
    // 只有**放行**才记忆。记住一次拒绝没有意义——下次同样的请求还是该问
    if (cmd.allow && suggest !== undefined) remember(ctx, entry, suggest, cmd.remember)
    return
  }
}
