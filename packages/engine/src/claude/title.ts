/**
 * 让 Claude 自己给这条会话起名。
 *
 * ## 为什么这条路走得通
 *
 * 因为它**把起名当功能暴露了出来**。SDK 里 `generateSessionTitle` 发的是
 * `subtype:"generate_session_title"` 控制请求，和 `askSideQuestion`、
 * `launchUltrareview` 并列——
 * 是产品级的一件事，不是内部零件（同 `aside.ts` 开头那段判据）。
 *
 * 反过来说清楚：omni **不会自己去凑一个名字**。拿第一句话截前二十个字、
 * 或者另起一次模型调用去总结，都是 omni 替引擎攒功能——而那正是总纲禁的那件事，
 * 何况 omni 压根不调 LLM API。哪一家没把起名暴露出来，那一家就还是显示第一句话。
 *
 * ## 传进去的是**用户自己的话**
 *
 * `description` 给的是那条会话的第一句提问原文，不是 omni 写的提示词——
 * 「不往模型的上下文里塞 omni 写的话」这条守得住。
 *
 * `persist` 不传：传 `true` 是替引擎决定「这个名字要写进你自己的会话档案」，
 * 传 `false` 是替它决定不写。不传就是**用它自己的默认**，这件事本来就该它说了算。
 *
 * ## 为什么是运行时探测，不是版本嗅探
 *
 * 同 `aside.ts`：SDK 0.3.231 的公开类型还没声明这个方法。
 * 嗅版本号要维护一张只可能过期的表；问一句 `typeof === "function"` 永远是当下的事实。
 */

/** SDK 没声明的那一小块。**只声明我们真的会调的部分**——多写一个字段就是多猜一次。 */
interface TitleCapable {
  generateSessionTitle: (description: string, options?: { persist?: boolean }) => Promise<unknown>
}

function capable(query: unknown): query is TitleCapable {
  return typeof (query as Partial<TitleCapable> | undefined)?.generateSessionTitle === "function"
}

/** 这条会话能不能让引擎起名。**探测的是手上这个 query 对象**，不是版本号。 */
export function canTitle(query: unknown): boolean {
  return capable(query)
}

/**
 * 起一个名字。**起不出来就返回 `undefined`**——不编一个，也不把这句话截一段冒充。
 *
 * 失败一律吞掉：起名是锦上添花，它挂了不该让这一轮跟着挂。调用方拿到
 * `undefined` 就当没有名字，会话照旧显示第一句话。
 */
export async function nameSession(query: unknown, first: string): Promise<string | undefined> {
  const seed = first.trim()
  if (!capable(query) || seed === "") return undefined
  const title = await query.generateSessionTitle(seed).catch(() => undefined)
  return typeof title === "string" && title.trim() !== "" ? title.trim() : undefined
}

/**
 * 会话的第一句话之后问一次名字，问到了就报上去。
 *
 * **「第一句话」的判据是这个原生会话是新起的**（既不是 `resume`、也不是原生分叉）：
 * 接回来的会话早就有过第一句话了，拿眼下这句去起名，等于让第五轮的话决定会话叫什么。
 * 插入（steer）也不算——那是同一轮里补的话。
 *
 * **发出去就不管**：名字是锦上添花，起名的那次往返不该挡住这一轮。
 * 宿主那边（`rememberTitle`）会挡住用户亲自起过的名字，这里不用操心。
 */
export function nameFirst(on: {
  /** 只问一次的闸门。**由调用方持有**，因为「一次」的范围是一条会话。 */
  once: { asked: boolean }
  query: unknown
  first: string
  resume: string | undefined
  forked: boolean
  onTitle: ((title: string) => void) | undefined
}): void {
  if (on.once.asked || on.resume !== undefined || on.forked) return
  on.once.asked = true
  void nameSession(on.query, on.first).then((title) => {
    if (title !== undefined) on.onTitle?.(title)
  })
}
