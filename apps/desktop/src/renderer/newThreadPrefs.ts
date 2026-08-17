import type { Thread } from "@omni/protocol"
import type { EnginePick, LastUsed } from "../shared/settings.js"

/**
 * 「下一条新会话开成什么样」——记下来，也用回去。
 *
 * ## 为什么这件事值得一个单独的文件
 *
 * 它由两半组成，而两半分别长在界面的两头：**记**发生在输入框（发出第一句话时），
 * **用**发生在侧栏（点新建时）。中间那条规则——「什么时候算数、什么时候不算」——
 * 如果散在两边，迟早会各自漂移成两套。放在这里，两边都读同一份判断。
 *
 * 纯函数、不碰 React：这样「同一条会话第二次发消息不该再刷新偏好」这类规则
 * 是能直接测的，不用去驱动一个组件。
 */

export interface Opened {
  engine: string
  model?: string
  effort?: string
}

/**
 * 开一条新会话该用哪家引擎、哪个模型。
 *
 * 优先级：**设置里明写的 > 上次开工用的 > 兜底**。
 *
 * 明写的压过上次用的，是因为用户去设置里改它就是为了不再每次手挑；
 * 而「上次用的」压过兜底，是因为它记的正是用户上一次的手挑。
 *
 * 模型**跟着最终选定的那家引擎查**，不是跟着 `lastUsed.engine` 查：
 * 设置里钉死了 claude、上次开工用的是 codex 时，
 * 拿 codex 的模型 id 去开 claude 会开出一条起不来的会话。
 */
export function openWith(last: LastUsed, defaultEngine: string, fallback: string): Opened {
  const engine = defaultEngine !== "" ? defaultEngine : last.engine !== "" ? last.engine : fallback
  const pick: EnginePick = last.byEngine[engine] ?? {}
  return {
    engine,
    ...(pick.model === undefined ? {} : { model: pick.model }),
    ...(pick.effort === undefined ? {} : { effort: pick.effort }),
  }
}

/**
 * 这条会话**发出第一句话**时，该把哪一套记成「下次新会话的默认」。
 * 不该记就给 undefined，调用方据此不写盘。
 *
 * ## 判据是「还没跑过任何一轮」
 *
 * `Thread.segments` 是在每一轮开始时落的（见 `host/prompt.ts`），
 * 所以空的就等于「这条会话还没真正开工」。这一刻的引擎+模型，
 * 正是用户为**新会话**挑的那一套。
 *
 * 之后同一条会话里再怎么换都不记：跑到一半换个强模型是**针对这段活**的
 * 临时决定，不是「我以后都这么开」。把它记成偏好的话，你为一个难题临时开的
 * high 会跟着你到之后每一条新会话。
 *
 * ## 「就用引擎默认」也是一种选择，要记
 *
 * `thread.model` 是 undefined 意味着用户没挑、用引擎自己的默认。
 * 这时把那一家原先记着的模型**删掉**——不删的话，用户明明退回默认了，
 * 下一条新会话又被拉回上上次那个模型。
 */
export function learnFrom(last: LastUsed, thread: Thread): LastUsed | undefined {
  if ((thread.segments ?? []).length > 0) return undefined
  /**
   * **记的是他挑的那家，不是此刻正在跑的那家。**
   *
   * 这一步发生在命令发给宿主**之前**（见 `useApp` 的 `send`），而开过工的会话
   * 切引擎是「下一句生效」——那一刻 `engine` 还是旧的、`nextEngine` 才是他挑的。
   * 只看 `engine` 的话：在 claude 里切到 codex 再发第一句，记下来的是 claude，
   * 而第二句起这个函数就不再记了（`segments` 非空），于是**那次选择永远学不到**。
   */
  const engine = thread.nextEngine ?? thread.engine
  // **换了一家就不带模型。** `thread.model` 是旧那家的 id，记到新那家名下的话，
  // 下一条新会话会拿一个它根本不认识的模型 id 去开——`openWith` 防的正是这个
  const pick: EnginePick =
    engine !== thread.engine
      ? {}
      : {
          ...(thread.model === undefined ? {} : { model: thread.model }),
          ...(thread.effort === undefined ? {} : { effort: thread.effort }),
        }
  const next: LastUsed = { engine, byEngine: withPick(last.byEngine, engine, pick) }
  // 没变就别写盘：每条会话的第一句都写一次没有意义，还会白白触发一轮渲染
  return same(last, next) ? undefined : next
}

function withPick(
  byEngine: Readonly<Record<string, EnginePick>>,
  engine: string,
  pick: EnginePick,
): Readonly<Record<string, EnginePick>> {
  // 空的（既没模型也没强度）就是「用引擎默认」——把那一项**滤掉**，别留一个空壳
  const empty = pick.model === undefined && pick.effort === undefined
  const rest = Object.fromEntries(Object.entries(byEngine).filter(([id]) => id !== engine))
  return empty ? rest : { ...rest, [engine]: pick }
}

function same(a: LastUsed, b: LastUsed): boolean {
  return a.engine === b.engine && JSON.stringify(a.byEngine) === JSON.stringify(b.byEngine)
}
