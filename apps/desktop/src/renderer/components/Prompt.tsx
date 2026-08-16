import { useRef } from "react"
import type { SlashCommand } from "@omni/protocol"
import { MentionList } from "./MentionList.js"
import { useMentions } from "../useMentions.js"
import { useSlash } from "../useSlash.js"
import { SlashList } from "./SlashList.js"

/**
 * 输入区：文本框 ＋ `@` 文件引用 ＋ `/` 命令面板。
 *
 * 文本本身由 `Composer` 持有（发送按钮也要用），这里只管
 * 「怎么输入」——两张候选表、键盘导航、光标复位。
 *
 * **两张表不会同时开**：`@` 要求光标前那个 token 以 `@` 开头，
 * `/` 只在整段文本的最开头才算命令。互斥是天然的，不用额外仲裁。
 */
export function Prompt({
  value,
  detached,
  busyHint = false,
  queueing = false,
  cwd,
  searchFiles,
  commands,
  onCommand,
  onChange,
  onSubmit,
}: {
  value: string
  detached: boolean
  /** 发不出去是因为「正在跑」而不是「这是历史」。文案要说清楚是哪一种。 */
  busyHint?: boolean
  /** 现在发出去会进队列，等这一轮跑完再发。占位文案据此换一种说法。 */
  queueing?: boolean
  cwd: string
  searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
  /** 这个会话能用的斜杠命令：引擎报的 ＋ omni 自己的。 */
  commands: readonly SlashCommand[]
  /** 选中了一条。omni 自己的就地执行，引擎的填进输入框等着按回车。 */
  onCommand: (command: SlashCommand) => void
  onChange: (text: string) => void
  onSubmit: () => void
}): React.JSX.Element {
  const input = useRef<HTMLTextAreaElement>(null)
  const mentions = useMentions(cwd, searchFiles)
  const slash = useSlash(commands)

  const choose = (path: string): void => {
    const el = input.current
    if (el === null) return
    const next = mentions.pick(path, value, el.selectionStart)
    if (next === undefined) return
    onChange(next.text)
    // 下一帧再摆光标：这一帧新的 value 还没写进 DOM
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(next.caret, next.caret)
    })
  }

  const pickCommand = (command: SlashCommand): void => {
    slash.close()
    onCommand(command)
  }

  return (
    <>
      <MentionList paths={mentions.paths} active={mentions.active} onPick={choose} />
      <SlashList commands={slash.hits} active={slash.active} onPick={pickCommand} />
      <textarea
        ref={input}
        className="composer__input"
        disabled={detached}
        // 输入框直接说清为什么用不了。留一个能打字却答非所问的框，比把它关掉糟得多
        placeholder={
          queueing
            ? "它还在跑——现在打的会排在后面，这一轮停了就发出去。"
            : busyHint
            ? "这一轮还在跑。等它停下，或者点右侧「停止」。"
            : detached
              ? "这是重启前的历史记录。点右侧「继续」把引擎接回来。"
              : "交代任务…（@ 引用文件，/ 用命令）"
        }
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          mentions.refresh(e.target.value, e.target.selectionStart)
          slash.refresh(e.target.value, e.target.selectionStart)
        }}
        onBlur={() => {
          mentions.close()
          slash.close()
        }}
        onKeyDown={(e) => {
          // 命令面板开着时它先吃按键
          if (slash.onKeyDown(e)) {
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault()
              const command = slash.hits[slash.active]
              if (command !== undefined) pickCommand(command)
            }
            return
          }
          // 候选列表开着时它先吃按键：上下移动、Esc 关闭、Enter/Tab 选中
          if (mentions.onKeyDown(e)) {
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault()
              const path = mentions.paths[mentions.active]
              if (path !== undefined) choose(path)
            }
            return
          }
          // Enter 发送，Shift+Enter 换行；IME 组字期间不拦（否则中文输入会被吞）
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            mentions.close()
            slash.close()
            onSubmit()
          }
        }}
      />
    </>
  )
}
