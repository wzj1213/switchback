import { useRef } from "react"
import { MentionList } from "./MentionList.js"
import { useMentions } from "../useMentions.js"

/**
 * 输入区：文本框 ＋ `@` 文件引用。
 *
 * 文本本身由 `Composer` 持有（发送按钮也要用），这里只管
 * 「怎么输入」——`@` 的候选、键盘导航、光标复位。
 */
export function Prompt({
  value,
  detached,
  cwd,
  searchFiles,
  onChange,
  onSubmit,
}: {
  value: string
  detached: boolean
  cwd: string
  searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
  onChange: (text: string) => void
  onSubmit: () => void
}): React.JSX.Element {
  const input = useRef<HTMLTextAreaElement>(null)
  const mentions = useMentions(cwd, searchFiles)

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

  return (
    <>
      <MentionList paths={mentions.paths} active={mentions.active} onPick={choose} />
      <textarea
        ref={input}
        className="composer__input"
        disabled={detached}
        // 输入框直接说清为什么用不了。留一个能打字却答非所问的框，比把它关掉糟得多
        placeholder={detached ? "这是重启前的历史记录。点右侧「继续」把引擎接回来。" : "交代任务…（@ 引用文件）"}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          mentions.refresh(e.target.value, e.target.selectionStart)
        }}
        onBlur={mentions.close}
        onKeyDown={(e) => {
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
            onSubmit()
          }
        }}
      />
    </>
  )
}
