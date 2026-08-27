import { useState } from "react"
import type { SlashCommand } from "@omni/protocol"
import { SendIcon, StopIcon } from "./icons.js"

/*
 * 输入区右下角那颗键，以及「选中一条命令之后往哪走」。
 * 从 `Composer` 拆出来是行数闸门逼的，但这一刀也顺：那边是「输入区怎么摆」，
 * 这边是「按下去会发生什么」。
 */

/**
 * 输入区右下角那一颗。**三种状态共用一个位置**：断开时是「继续这个会话」，
 * 跑着时是停止，其余时候是发送。手已经知道往哪儿点，换的是形状不是位置。
 */
export function Action({
  detached,
  busy,
  starting,
  empty,
  aside,
  onResume,
  onInterrupt,
  onSend,
}: {
  detached: boolean
  busy: boolean
  /** 引擎还在起。**不是「停止」**：那时没有任何东西可停 */
  starting: boolean
  empty: boolean
  /** 侧问模式：这一下发出去不进正文。**键要跟着变色**——见下面那段。 */
  aside?: boolean
  onResume?: () => void
  onInterrupt?: () => void
  onSend: () => void
}): React.JSX.Element {
  if (detached) return <Resume onResume={onResume} />
  // 起引擎的那几百毫秒里摆一颗禁着的「发送」——摆「停止」是在说谎，
  // 那时候没有任何东西可停
  if (starting) {
    return (
      <button className="send" type="button" data-tip="引擎正在启动" aria-label="发送" disabled>
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
 * 「继续这个会话」——**点下去要立刻有反应**。
 *
 * 恢复会话得把引擎重新拉起来、握手、读回历史，几百毫秒到几秒不等。
 * 上一版点完按钮纹丝不动，于是人会再点一次、再点一次——命令层虽然去重了，
 * 但那是在**兜底**，不是在回应。按钮自己要说话。
 */
function Resume({ onResume }: { onResume?: () => void }): React.JSX.Element {
  const [going, setGoing] = useState(false)
  return (
    <button
      /* **不是主按钮。** 近黑的实心块是留给「你现在要做个决定」的（审批卡那颗）；
         「这条会话是历史」是一个**状态**，不是一件催你办的事。输入框里那句
         占位文本已经把话说清了，而这是这一条里唯一能点的控件，找不着的风险为零 */
      className="btn composer__resume"
      type="button"
      disabled={going || onResume === undefined}
      onClick={() => {
        setGoing(true)
        onResume?.()
      }}
    >
      {going ? "正在恢复…" : "继续这个会话"}
    </button>
  )
}

/**
 * 选中一条命令之后往哪走。
 *
 * **两种命令，两种去处**：omni 自己的就地执行——它们没有参数，
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
  onOmni: (name: string) => void,
): void {
  if (command.source === "omni") {
    setText("")
    setCommand(undefined)
    onOmni(command.name)
    return
  }
  setText("")
  setCommand(command)
}
