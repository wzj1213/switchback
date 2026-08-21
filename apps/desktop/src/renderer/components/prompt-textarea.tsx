import type { SlashCommand } from "@omni/protocol"
import type { useMentions } from "../useMentions.js"
import type { useSlash } from "../useSlash.js"

export function promptPlaceholder(state: {
  command: SlashCommand | undefined
  starting: boolean
  steering: boolean
  queueing: boolean
  detached: boolean
}): string {
  if (state.command !== undefined) return state.command.argumentHint ?? "输入参数（可选）"
  if (state.starting) return "引擎正在启动，起来就能发。"
  if (state.steering) return "它还在跑——回车排队，⌘⏎ 直接插入当前轮次。"
  if (state.queueing) return "它还在跑——回车排队，这一轮停下后发送。"
  if (state.detached) return "这是重启前的历史记录。点右侧「继续」把引擎接回来。"
  return "交代任务…（@ 引用文件，/ 用命令）"
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
  onPaste: (items: DataTransferItemList | null) => Promise<boolean>
  clearCommand: () => void
  choose: (path: string) => void
  pickCommand: (command: SlashCommand) => void
  onSubmit: (steer: boolean) => void
}

export function PromptTextarea(props: Props): React.JSX.Element {
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
        void props.onPaste(event.clipboardData.items).then((took) => {
          if (took) event.preventDefault()
        })
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
  if (removeCommand(event, props)) return
  if (chooseSlash(event, props)) return
  if (chooseMention(event, props)) return
  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
    event.preventDefault()
    props.mentions.close()
    props.slash.close()
    props.onSubmit(event.metaKey || event.ctrlKey)
  }
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
