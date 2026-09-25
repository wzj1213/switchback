import type { Thread } from "@omni/protocol"
import type { Ctx, Live } from "./ctx.js"

/**
 * 换家之后的第一句话前面附的那段交接说明（用户开着「换引擎自动交接」时）。
 *
 * ## 怎么认「换家后的第一句」
 *
 * 看**最后一段记录是不是当前这一家**。分段要等这一家有了原生会话句柄、真正说过话才落
 *（见 `segment.ts`），所以新那家还没落下自己那一段，这句话就是它听到的第一句。
 *
 * 不在切换那一刻打标记：切换有好几条路（发话时兑现 `nextEngine`、「现在就切」、
 * 排进队的那句被 drain 时才兑现），标记得在每条路上各记一次、各清一次，漏一处就是
 * 该附的没附、或者每句都附。「最后一段是谁」一处就答完了，还顺带盖住一种情况：
 * 新那家第一轮没拿到句柄就失败了，它手里还没有一条接得住的原生会话，
 * 下一句本来就该再附一次。
 *
 * ## 说明由谁写
 *
 * 宿主只判定时机。说明的内容要碰文件（转写落盘、读原始记录），由调用方经
 * `HostDeps.handoffBrief` 给；开关也在那边——用户关了就不给。
 * 不给、给不出（读盘失败）都照旧只发用户那一句：交接说明是帮忙的，不能因为它发不出话。
 */
export function isFirstAfterSwitch(thread: Thread): boolean {
  const last = thread.segments?.at(-1)
  if (last === undefined) return false
  return last.engine !== thread.engine || last.profile !== thread.engineProfile
}

export async function handoffNote(ctx: Ctx, entry: Live): Promise<string | undefined> {
  const brief = ctx.deps.handoffBrief
  if (brief === undefined || !isFirstAfterSwitch(entry.thread)) return undefined
  const note = await brief(entry.thread).catch(() => undefined)
  return note === undefined || note.trim() === "" ? undefined : note
}

/** 真正送给引擎的那段话：说明在前，用户那句在后，中间空一行。 */
export function withNote(text: string, note: string | undefined): string {
  return note === undefined ? text : `${note}\n\n${text}`
}
