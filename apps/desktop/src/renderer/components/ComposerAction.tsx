import type { SlashCommand } from "@switchback/protocol"
import { SendIcon, StopIcon } from "./icons.js"

/*
 * 输入区右下角那颗键，以及「选中一条命令之后往哪走」。
 * 从 `Composer` 拆出来是行数闸门逼的，但这一刀也顺：那边是「输入区怎么摆」，
 * 这边是「按下去会发生什么」。
 */

/**
 * 输入区右下角那一颗。**两种状态共用一个位置**：跑着时是停止，其余时候是发送。
 * 手已经知道往哪儿点，换的是形状不是位置。
 *
 * 历史会话上它也是「发送」：上一版这里是一颗「继续这个会话」，要先点它接回引擎才能打字，
 * 而它只认原来那一家——那一家被删掉，这条会话就再也打不开了。现在发话时宿主先接回来。
 */
export function Action({
  held,
  busy,
  starting,
  empty,
  aside,
  onInterrupt,
  onSend,
}: {
  /** 历史会话接不回来（见 `history-note.ts`）：禁着的「发送」，悬停说怎么办。 */
  held: boolean
  busy: boolean
  /** 引擎还在起。**不是「停止」**：那时没有任何东西可停 */
  starting: boolean
  empty: boolean
  /** 侧问模式：这一下发出去不进正文。**键要跟着变色**——见下面那段。 */
  aside?: boolean
  onInterrupt?: () => void
  onSend: () => void
}): React.JSX.Element {
  // 起引擎的那几百毫秒里摆一颗禁着的「发送」——摆「停止」是在说谎，
  // 那时候没有任何东西可停
  const hold = starting ? "引擎正在启动" : held ? "先换一家引擎再发" : undefined
  if (hold !== undefined) {
    return (
      <button className="send" type="button" data-tip={hold} aria-label="发送" disabled>
        <SendIcon />
      </button>
    )
  }
  if (busy) {
    // 跑着的时候把「发送」换成「停止」而不是灰掉：**这时候人真正想按的是停止**，
    // 而一个灰掉的发送键只告诉他「不能发」，没告诉他还能做什么
    return (
      <button
        className="send send--stop"
        type="button"
        data-tip="停止（Esc）"
        aria-label="停止"
        onClick={onInterrupt}
        disabled={onInterrupt === undefined}
      >
        <StopIcon />
      </button>
    )
  }
  /* **侧问模式下这颗键要看得出不一样。**「跑着的时候换成停止」是同一条道理：
     这一下按出去会发生什么，得由键自己说，不能只写在别处的芯片上。 */
  return (
    <button
      className={`send${aside === true ? " send--aside" : ""}`}
      type="button"
      data-tip={aside === true ? "作为侧问发送（⌥⌘↵）——不进正文" : "发送（⌘↵）"}
      aria-label={aside === true ? "作为侧问发送" : "发送"}
      onClick={onSend}
      disabled={empty}
    >
      <SendIcon />
    </button>
  )
}

/**
 * 选中一条命令之后往哪走。
 *
 * **两种命令，两种去处**：Switchback 自己的就地执行——它们没有参数，
 * 执行完这条输入就完了，所以顺手把输入框清空；引擎的填进输入框，
 * 带参数的还等着人填。
 *
 * 统一成「选完再按回车」而不是「没参数的选完就跑」：后者更省一次按键，
 * 但代价是同一个动作有时会发出去、有时不会，而**那个区别在选之前看不出来**。
 */
export function takeCommand(
  command: SlashCommand,
  setText: (text: string) => void,
  setCommand: (command: SlashCommand | undefined) => void,
  onSwitchback: (name: string) => void,
): void {
  if (command.source === "switchback") {
    setText("")
    setCommand(undefined)
    onSwitchback(command.name)
    return
  }
  setText("")
  setCommand(command)
}
