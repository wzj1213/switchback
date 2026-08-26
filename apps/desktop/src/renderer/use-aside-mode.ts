import { useEffect, useRef, useState } from "react"
import type { SlashCommand } from "@omni/protocol"

/**
 * 侧问模式：**这一句发出去不进正文**。
 *
 * ## 为什么是一个模式，不是一颗按钮
 *
 * 上一版是输入区那一排里一颗带描边的胶囊，点开在它上方弹一个浮层，
 * 浮层里再放一个两行高的小文本框。三处不对：
 *
 * 1. **站错了队。** 那一排说的是「正文这一句由谁、以什么权限、用哪个模型去跑」
 *    ——四件事都在描述**这一句的去向**。侧问不改这一句的任何属性。
 * 2. **它是那一排里唯一带描边的东西**，比模型选择器还响，而它没那么重要。
 * 3. **为了打字先开一个更小的打字框。** 你面前本来就有一个大文本框——
 *    侧问只是它的**另一个去向**，不该是另一个输入框。
 *
 * 所以现在：`/侧问` 或 `⌥⌘↩`，输入框原地变成侧问模式，芯片和发送键颜色一直在说
 * 「这一句不进正文」，`Esc` 退出。
 *
 * ## 这个模式一定要显眼
 *
 * 反过来的风险是真的：你以为在交代任务，其实发进了侧通道——那一句就白打了。
 * 所以芯片用强调色（见 `.composer__asidechip` 的注释），而落在转录区的那张卡
 * 反倒不上色：那里要说的是「不属于正文」，虚线和缩进已经说完。
 *
 * ## 为什么这套胶水住在一个 hook 里
 *
 * 它要同时改四处：斜杠命令表、命令被选中之后往哪走、这一句发给谁、
 * 以及输入框和发送键的样子。摊回 `Composer` 里就是四段互相看不见的 if——
 * 收在这里，`Composer` 只剩「把它接上」。
 */
export const ASIDE_COMMAND: SlashCommand = {
  name: "侧问",
  label: "侧问",
  description: "问一句不进正文的话——答案落在转录区，但不进发给引擎的上下文",
  source: "omni",
}

type Send = (text: string, attachments: readonly string[], steer: boolean) => void

export interface AsideMode {
  /** 此刻在侧问模式里。 */
  on: boolean
  /** 退回普通发送。 */
  exit: () => void
  /** 能用的时候把 `/侧问` 拼进命令表。 */
  commands: (base: readonly SlashCommand[]) => readonly SlashCommand[]
  /** 选中的是不是 `/侧问`。**是的话就地进模式**，调用方不用再往下走。 */
  take: (command: SlashCommand, clear: () => void) => boolean
  /** 包一层发送：模式开着就走侧通道，否则原样往下发。 */
  wrapSend: (send: Send) => Send
  /** `⌥⌘↩`：**不进模式**，直接把手上这一句当侧问发出去。 */
  ask: (text: string, hasCommand: boolean, clear: () => void) => void
}

export function useAsideMode(options: {
  /** 引擎报了这个能力、会话已经开过工、而且此刻发得出去。 */
  can: boolean
  /**
   * 外面推进来的一次「就地问」（选中转录区一段话之后那颗）。
   * 和 `useComposerDraft` 的 `usePrefill` 各记各的 `at`——
   * 它们要做的事不一样：那边填文本，这边定去向。
   */
  prefill?: { aside?: boolean; at: number }
  onAsk?: (text: string) => void
  initial?: boolean
}): AsideMode {
  const [on, setOn] = useState(options.initial === true)
  // **能力没了就退出。** 换引擎、断开、或者会话被回放成历史都会走到这里；
  // 留在一个发不出去的模式里，用户下一次回车会什么都不发生
  useEffect(() => {
    if (!options.can) setOn(false)
  }, [options.can])
  const seen = useRef(options.prefill?.at ?? 0)
  useEffect(() => {
    const next = options.prefill
    if (next === undefined || next.at === seen.current) return
    seen.current = next.at
    // 普通的「改一改再发」也走 prefill，那时 `aside` 是 undefined——
    // 于是它顺手把模式关掉，这是对的：那一句是要进正文的
    setOn(next.aside === true)
  }, [options.prefill])

  const live = on && options.can
  const onAsk = options.onAsk
  const exit = (): void => {
    setOn(false)
  }
  return {
    on: live,
    exit,
    commands: (base) => (options.can ? [ASIDE_COMMAND, ...base] : base),
    take: (command, clear) => {
      /* `/侧问` **就地进模式**，不走 `onOmni`：那一路是「工作区能做的事」
         （新建、分叉、导出…），而这一条改的是**手上这一句的去向**，
         它的状态本来就住在输入框里。 */
      if (command.source !== "omni" || command.name !== ASIDE_COMMAND.name) return false
      clear()
      setOn(true)
      return true
    },
    wrapSend: (send) => (text, attachments, steer) => {
      /* **发完退出模式**——连问两句的人会再打一次 `/侧问`，
         而默认留在模式里的代价是下一句正经任务被静默吞掉。 */
      if (live && onAsk !== undefined) {
        onAsk(text)
        setOn(false)
        return
      }
      send(text, attachments, steer)
    },
    ask: (text, hasCommand, clear) => {
      // 选了引擎命令时不适用：那一句的去向已经由命令决定了
      const trimmed = text.trim()
      if (!options.can || onAsk === undefined || hasCommand || trimmed === "") return
      onAsk(trimmed)
      clear()
    },
  }
}
