import type { Thread } from "@switchback/protocol"

/**
 * 「承接上一段」——把**上一家引擎自己那份原始记录的路径**填进输入框。
 *
 * ## 它解决的是一串手工动作
 *
 * 一家引擎卡住了要换另一家，现在的路是：开 `/timeline` → 找到上一段 →
 * 复制那条路径 → 回输入框粘上 → 再打一句「读一下这个」。五步里有四步
 * 是搬运，而搬运的东西 Switchback 手上本来就有（`Thread.segments`）。
 * 这个函数把那四步收成一次按键。
 *
 * ## 它**只填路径，不填话**
 *
 * 填进去的是一条 `@路径` 引用——和你亲手拖一个文件进来得到的东西一模一样，
 * 看得见、改得动、不发送就不生效。**Switchback 不替你写那句「读一下这个」**：
 * 那是你的话，不是它的（见 `AGENTS.md`：不往模型的上下文里塞 Switchback 写的话）。
 * 要读多少、读来干什么，由你在后面自己打。
 *
 * ## 「上一段」是哪一段
 *
 * 最后一段**不归下一句要用的那家**、而且拿得到本地记录的。判据用
 * `nextEngine ?? engine` 而不是 `engine`：点完下拉还没说话时切换尚未兑现
 *（见 `Thread.nextEngine`），那时 `engine` 还是旧那家——照它算的话，
 * 会把要交出去的那份记录当成「自己的」而跳过，于是这颗键在最该用的时刻没有反应。
 */
export interface Pickup {
  /** 上一家引擎的原始记录路径，直接进输入框当 `@` 引用。 */
  path: string
  /** 上一家引擎的 id。菜单与提示要说清承接的是谁。 */
  engine: string
}

export function pickupOf(thread: Thread): Pickup | undefined {
  const mine = thread.nextEngine ?? thread.engine
  const found = (thread.segments ?? []).findLast(
    (segment) => segment.engine !== mine && segment.logPath !== undefined,
  )
  return found?.logPath === undefined ? undefined : { path: found.logPath, engine: found.engine }
}
