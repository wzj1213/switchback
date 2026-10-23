import type { EngineInfo, Thread } from "@switchback/protocol"
import { cannotRevive } from "@switchback/store"
import type { Locale } from "@switchback/i18n"
import { HISTORY_NOTE } from "./history-note.messages.js"

/**
 * 历史会话（`Thread.detached`）的输入框先交代的那一句：发出去会发生什么，或者为什么还发不了。
 *
 * 规矩在宿主（`@switchback/host` 的 `revive.ts`）：发话时先接回——续原来那家，
 * 或者由挑过的另一家（`nextEngine`）接着做。这里只把它说成人话，**不替宿主做判定**。
 *
 * 唯一拦着的是「没换家、原来那家又没留下句柄」：宿主必拒，记录上就看得出来，
 * 不必让人发一次、等一次报错才知道。
 *
 * 「原来那家不在引擎列表里」**只提示、不拦**：列表只装着探测完、设置里也开着的那几家——
 * 被删掉的 ACP 引擎不在，关掉的也不在（关掉的宿主其实还接得回），启动那几秒里慢的还没探完。
 * 真接不回来由宿主报错，那句话也会退回输入框。
 */
export interface HistoryNote {
  text: string
  /** 宿主必拒：发送键灰着，换一家引擎才能发。 */
  held: boolean
}

/**
 * @param engines 显示用的清单，只拿来取名字（补过当前会话那家，见 `withThreadEngines`）
 * @param catalog 引擎清单本身，判断原来那家还在不在
 */
export function historyNote(
  thread: Thread,
  engines: readonly EngineInfo[],
  catalog: readonly EngineInfo[],
  locale: Locale,
): HistoryNote | undefined {
  if (thread.detached !== true) return undefined
  const m = HISTORY_NOTE[locale]
  const label = (id: string): string => engines.find((engine) => engine.id === id)?.label ?? id
  const to = thread.nextEngine ?? thread.engine
  if (to !== thread.engine) return { text: m.next(label(to)), held: false }
  if (cannotRevive(thread)) {
    return {
      text: m.noHandle(label(to)),
      held: true,
    }
  }
  if (catalog.length > 0 && !catalog.some((engine) => engine.id === to)) {
    return { text: m.gone(label(to)), held: false }
  }
  return { text: m.revive(label(to)), held: false }
}
