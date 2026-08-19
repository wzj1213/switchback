/**
 * 侧问：问一句不打断主线的问题。
 *
 * ## 为什么只有 claude 有这个入口
 *
 * 因为只有它**把侧问当功能暴露了出来**。SDK 里 `askSideQuestion` 发的是
 * `subtype:"side_question"` 控制请求，和 `generateSessionTitle`、`launchUltrareview`
 * 并列——是产品级的一件事，不是内部零件。
 *
 * 别家不是不能「做出来」：codex 的 TUI 就是拿 `thread/fork(ephemeral)` +
 * 自己写的两段边界提示词拼的，kimi 的 `/btw` 也很完整。但那两条都**没从它们对外的
 * 那扇门出来**——omni 要照着拼，就得把厂商的提示词抄一份进自己的源码维护，
 * 那撞 `AGENTS.md` 的总纲（omni 与引擎是共建者，不是上下级）。所以那两家报 false。
 *
 * ## 为什么是运行时探测，不是版本嗅探
 *
 * SDK 0.3.231 的公开类型还没声明这个方法——
 * 类型声明落后于实现。嗅版本号得维护一张「哪个版本开始有」的表，而那张表
 * 只可能过期；问一句 `typeof === "function"` 永远是当下的事实。
 */

/** SDK 没声明的那一小块。**只声明我们真的会调的部分**——多写一个字段就是多猜一次。 */
interface SideQuestionCapable {
  askSideQuestion: (question: string) => Promise<{ response: string } | null>
}

function capable(query: unknown): query is SideQuestionCapable {
  return typeof (query as Partial<SideQuestionCapable> | undefined)?.askSideQuestion === "function"
}

/** 这条会话能不能侧问。**探测的是手上这个 query 对象**，不是版本号。 */
export function canAside(query: unknown): boolean {
  return capable(query)
}

/**
 * 问一句。
 *
 * **不传 `history`。** 那个参数是「omni 额外往里塞什么上下文」，而这条会话的上下文
 * 引擎自己就有；替它挑「该记得什么」是 omni 在替引擎做决定，撞总纲第一条。
 *
 * 回 `null` 表示引擎那边没给出答案（实测签名允许）。**不编一句占位**：
 * 一条编出来的「没有回答」和一条真的回答在界面上分不出来。
 */
export async function askAside(query: unknown, text: string): Promise<string> {
  if (!capable(query)) throw new Error("这条会话不支持侧问")
  const result = await query.askSideQuestion(text)
  const answer = result?.response
  if (answer === undefined || answer === "") throw new Error("引擎没有给出侧问的回答")
  return answer
}
