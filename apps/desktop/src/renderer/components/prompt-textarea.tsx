import { useEffect } from "react"
import { flushSync } from "react-dom"
import type { SlashCommand } from "@omni/protocol"
import type { useMentions } from "../useMentions.js"
import type { useSlash } from "../useSlash.js"
import { hasFileItems } from "../attachment-feedback.js"

export function promptPlaceholder(state: {
  command: SlashCommand | undefined
  starting: boolean
  steering: boolean
  queueing: boolean
  detached: boolean
  aside: boolean
}): string {
  if (state.command !== undefined) return state.command.argumentHint ?? "输入参数（可选）"
  // 侧问模式排在最前：它改的是**这一句去哪儿**，比「它还在跑」更要紧——
  // 那几句说的都是「什么时候到」，而这一句说的是「到不到正文里」
  if (state.aside) return "问一句不进正文的话…（Esc 退回普通发送）"
  if (state.starting) return "引擎正在启动，起来就能发。"
  if (state.steering) return "它还在跑——回车排队，⌘⏎ 直接插入当前轮次。"
  if (state.queueing) return "它还在跑——回车排队，这一轮停下后发送。"
  if (state.detached) return "这是重启前的历史记录。点右侧「继续」把引擎接回来。"
  return "交代任务…（可拖入文件，@ 搜索，/ 用命令）"
}

interface Props {
  input: React.RefObject<HTMLTextAreaElement | null>
  value: string
  detached: boolean
  command: SlashCommand | undefined
  placeholder: string
  mentions: ReturnType<typeof useMentions>
  slash: ReturnType<typeof useSlash>
  onChange: (text: string) => void
  onPaste: (items: DataTransferItemList | null) => Promise<void>
  clearCommand: () => void
  choose: (path: string) => void
  pickCommand: (command: SlashCommand) => void
  onSubmit: (steer: boolean) => void
  /** `⌥⌘↩`：**不进模式，直接把这一句当侧问发出去**。没有这个能力时缺席。 */
  onAside?: () => void
  /** 已经在侧问模式里：`Esc` 退回普通发送。 */
  asideMode?: boolean
  onAsideExit?: () => void
}

export function PromptTextarea(props: Props): React.JSX.Element {
  useEffect(() => {
    if (props.mentions.pendingPath !== undefined) props.choose(props.mentions.pendingPath)
  }, [props.choose, props.mentions.pendingPath])
  return (
    <textarea
      ref={props.input}
      className="composer__input"
      disabled={props.detached}
      placeholder={props.placeholder}
      value={props.value}
      aria-label={props.command === undefined ? "任务" : `${props.command.name} 的参数`}
      onChange={(event) => {
        props.onChange(event.target.value)
        props.mentions.refresh(event.target.value, event.target.selectionStart)
        if (props.command === undefined)
          props.slash.refresh(event.target.value, event.target.selectionStart)
      }}
      onPaste={(event) => {
        const items = event.clipboardData.items
        if (!hasFileItems(items)) return
        // Finder 会同时给图片和路径文本。必须在异步落盘前拦住，`.then()` 里已经太迟。
        event.preventDefault()
        void props.onPaste(items)
      }}
      onBlur={() => {
        props.mentions.close()
        props.slash.close()
      }}
      onKeyDown={(event) => onKeyDown(event, props)}
    />
  )
}

function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>, props: Props): void {
  if (asideKeys(event, props)) return
  if (removeCommand(event, props)) return
  if (releaseCompletion(event, props)) return
  if (chooseSlash(event, props)) return
  if (chooseMention(event, props)) return
  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
    event.preventDefault()
    props.mentions.close()
    props.slash.close()
    props.onSubmit(event.metaKey || event.ctrlKey)
  }
}

/** 反向 Tab 不确认候选；先同步卸掉浮层，再让浏览器寻找真正的上一站。 */
function releaseCompletion(event: React.KeyboardEvent<HTMLTextAreaElement>, props: Props): boolean {
  const open = props.mentions.open || props.slash.hits.length > 0
  if (event.key !== "Tab" || !event.shiftKey || !open) return false
  flushSync(() => {
    props.mentions.close()
    props.slash.close()
  })
  return true
}

/**
 * 侧问那两个键。**必须排在普通回车之前**：`⌥⌘↩` 的 `metaKey` 也是真的，
 * 落到下面那一支就成了「插进当前轮次」——正好相反的一件事。
 */
function asideKeys(event: React.KeyboardEvent<HTMLTextAreaElement>, props: Props): boolean {
  if (
    event.key === "Enter" &&
    event.altKey &&
    (event.metaKey || event.ctrlKey) &&
    !event.nativeEvent.isComposing &&
    props.onAside !== undefined
  ) {
    event.preventDefault()
    props.onAside()
    return true
  }
  if (event.key === "Escape" && props.asideMode === true && props.onAsideExit !== undefined) {
    event.preventDefault()
    props.onAsideExit()
    return true
  }
  return false
}

function removeCommand(event: React.KeyboardEvent<HTMLTextAreaElement>, props: Props): boolean {
  if (props.command === undefined || !removesCommand(event, props.value)) return false
  event.preventDefault()
  props.clearCommand()
  return true
}

function chooseSlash(event: React.KeyboardEvent<HTMLTextAreaElement>, props: Props): boolean {
  if (!props.slash.onKeyDown(event)) return false
  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault()
    const command = props.slash.hits[props.slash.active]
    if (command !== undefined) props.pickCommand(command)
  }
  return true
}

function chooseMention(event: React.KeyboardEvent<HTMLTextAreaElement>, props: Props): boolean {
  if (!props.mentions.onKeyDown(event)) return false
  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault()
    const path = props.mentions.paths[props.mentions.active]
    if (path !== undefined) props.choose(path)
  }
  return true
}

/** 参数为空且光标在最前面时，Backspace 回到普通输入态。 */
function removesCommand(event: React.KeyboardEvent<HTMLTextAreaElement>, value: string): boolean {
  return event.key === "Backspace" && value === "" && event.currentTarget.selectionStart === 0
}
