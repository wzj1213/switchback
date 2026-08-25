import type { Command, RememberScope, ThreadId } from "@omni/protocol"
import type { ApprovalAnswer, ApprovalAsk, InteractionWait } from "@omni/engine"
import type { Rule } from "@omni/approval"
import { emit, setStatus, type Ctx, type Live } from "./ctx.js"

/**
 * 审批：问人、记住答案、落定。
 *
 * 「记住」这件事的三处语义都在这里：session 只进内存、project 要写盘、
 * 拒绝一律不记。
 */

const DENIED: ApprovalAnswer = { allow: false, remember: "once" }

const PASSED: ApprovalAnswer = { allow: true, remember: "once" }

const aborted = (wait: InteractionWait | undefined): boolean => wait?.signal?.aborted === true

/**
 * 这次要不要直接放行（用户点过「本轮剩下的都放行」）。
 *
 * **红线不受它影响。** 那 8 条（凭据读取、越界删除、往工作区外写…）正是最不该
 * 被一次点击盖掉的；一个能盖掉红线的按钮，等于把档位机制整个绕过去了。
 * 界面上也照这句话写，免得用户以为点完就再也不会被打断。
 */
function passes(entry: Live, ask: ApprovalAsk): boolean {
  return entry.passTurn !== undefined && entry.passTurn === entry.turn && ask.redline === undefined
}

export async function askUser(
  ctx: Ctx,
  id: ThreadId,
  ask: ApprovalAsk,
  wait?: InteractionWait,
): Promise<ApprovalAnswer> {
  const entry = ctx.live.get(id)
  // 会话已关闭却还有审批请求进来：按拒绝落定，不能让驱动永远等着
  if (entry === undefined || entry.turn === undefined || aborted(wait)) return DENIED
  // **不发卡、不改状态**：armed 之后再弹一张「已自动允许」的卡，
  // 等于把用户刚才想省掉的那些打断又原样还回去。做了什么在工具行里照样看得见
  if (passes(entry, ask)) return PASSED
  setStatus(ctx, entry, "waiting_approval")
  const itemId = ctx.deps.newId("ap")
  // 记下建议规则：用户勾了记忆之后，要存的是**规则本身**，
  // 而 `approval.resolve` 命令只带 itemId 回来
  if (ask.suggest !== undefined) entry.suggests.set(itemId, ask.suggest)
  const abort = (): void => {
    entry.gate.cancelApproval(itemId)
  }
  const pending = entry.gate.open({ ask, turnId: entry.turn, at: ctx.deps.now(), itemId })
  if (aborted(wait)) abort()
  else wait?.signal?.addEventListener("abort", abort, { once: true })
  try {
    return await pending
  } finally {
    wait?.signal?.removeEventListener("abort", abort)
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

/**
 * 同一条 omni 对话换原生进程时，内存里的审批规则继续生效。
 *
 * 新进程已经从磁盘读了最新 project 规则；旧 Live 里还可能有尚未写完的 project 规则，
 * 以及只属于“此对话”的 session 规则。按 id 合并并让旧 Live 的当前值覆盖，
 * 才不会让一次换引擎/权限重启偷偷撤销用户刚做的选择。
 */
export function carryRules(from: Live, into: Live): void {
  const merged = new Map(into.rules.map((rule) => [rule.id, rule]))
  for (const rule of from.rules) merged.set(rule.id, rule)
  into.rules = [...merged.values()]
}

/** 审批卡 id 全局唯一，所以挨个会话问一遍即可；命中就停。 */
export function resolveApproval(ctx: Ctx, cmd: Extract<Command, { type: "approval.resolve" }>): void {
  for (const entry of ctx.live.values()) {
    const suggest = entry.suggests.get(cmd.itemId)
    // 范围原样往下传：以前这里压成 boolean，engine 就再也分不出
    // 「这一次」和「这轮对话」了
    const hit = entry.gate.resolve(cmd.itemId, { allow: cmd.allow, remember: cmd.remember })
    if (!hit) continue
    // **只在放行时 arm**：「拒绝并且本轮都放行」不是一个说得通的意图。
    // 记的是当前轮次 id，下一轮自然失效
    if (cmd.allow && cmd.passTurn === true) {
      entry.passTurn = entry.turn
      // 也写进 thread 发出去：这个状态必须在界面上看得见（见 `Thread.passTurn`）
      entry.thread = { ...entry.thread, ...(entry.turn === undefined ? {} : { passTurn: entry.turn }) }
      emit(ctx, { type: "thread.updated", at: ctx.deps.now(), thread: entry.thread })
    }
    // 只有**放行**才记忆。记住一次拒绝没有意义——下次同样的请求还是该问
    if (cmd.allow && suggest !== undefined) remember(ctx, entry, suggest, cmd.remember)
    return
  }
}
