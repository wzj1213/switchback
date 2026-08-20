import { useRef } from "react"
import type { SlashCommand } from "@omni/protocol"
import { MentionList } from "./MentionList.js"
import { useMentions } from "../useMentions.js"
import { useSlash } from "../useSlash.js"
import { ghostOf } from "../slash.js"
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
  starting = false,
  queueing = false,
  steering = false,
  cwd,
  searchFiles,
  onPaste,
  commands,
  onCommand,
  onChange,
  onSubmit,
}: {
  value: string
  detached: boolean
  /** 引擎还在起：发不出去，但**不是**因为「正在跑」。 */
  starting?: boolean
  /** 现在发出去会进队列，等这一轮跑完再发。输入框在这里集中说明发送行为。 */
  queueing?: boolean
  /**
   * 现在发出去会**直接递进正在跑的那一轮**（codex 的 `turn/steer`）。
   *
   * 和 `queueing` 互斥：两者都是「它还在跑的时候你打字」，
   * 但一个允许明确插入、一个只能等着——这正是用户最需要知道的差别。
   */
  steering?: boolean
  cwd: string
  searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
  /** 贴进来的东西里有图就收下。返回 true 表示收了，调用方据此拦掉默认粘贴。 */
  onPaste: (items: DataTransferItemList | null) => Promise<boolean>
  /** 这个会话能用的斜杠命令：引擎报的 ＋ omni 自己的。 */
  commands: readonly SlashCommand[]
  /** 选中了一条。omni 自己的就地执行，引擎的填进输入框等着按回车。 */
  onCommand: (command: SlashCommand) => void
  onChange: (text: string) => void
  /** 参数是「别排队，现在就插进去」（⌘⏎）。 */
  onSubmit: (steer: boolean) => void
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
      <SlashList commands={slash.hits} query={slash.query} active={slash.active} onPick={pickCommand} />
      {/* **灰字预览和输入框必须共用一个原点。** 它是一层贴在文本框上的镜像：
          你打的字画成透明的占住位置，后面那截灰字才落在光标正后方。
          差一个像素的内边距或字体，这层就露馅——所以两者都写 `font: inherit`、
          `padding: 0`，谁也不许单独调 */}
      <div className="composer__field">
      <Ghost typed={value} rest={ghostOf(slash.hits[slash.active], slash.query)} />
      <textarea
        ref={input}
        className="composer__input"
        disabled={detached}
        // 输入框直接说清为什么用不了。留一个能打字却答非所问的框，比把它关掉糟得多
        placeholder={
          starting
            ? "引擎正在启动，起来就能发。"
            : steering
            ? "它还在跑——回车排队，⌘⏎ 直接插入当前轮次。"
            : queueing
            ? "它还在跑——回车排队，这一轮停下后发送。"
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
        onPaste={(e) => {
          // 先看有没有图。有图就拦掉默认粘贴——否则文件名会以文本形式落进输入框
          void onPaste(e.clipboardData.items).then((took) => {
            if (took) e.preventDefault()
          })
        }}
        onBlur={() => {
          mentions.close()
          slash.close()
        }}
        onKeyDown={(e) => {
          onPromptKey(e, { mentions, slash, choose, pickCommand, onSubmit })
        }}
      />
      </div>
    </>
  )
}

/**
 * 光标后面那截灰字：**按下 Tab 或回车会补上的东西**。
 *
 * `aria-hidden`：读屏用户听到的应该是候选列表（那是个 `listbox`，
 * 高亮的那一条会被念出来），而不是一段和输入框里的字重复的幽灵文本。
 */
function Ghost({ typed, rest }: { typed: string; rest: string }): React.JSX.Element | null {
  if (rest === "") return null
  return (
    <div className="composer__ghost" aria-hidden="true">
      <span className="composer__ghost-typed">{typed}</span>
      {rest}
    </div>
  )
}

/** 按着修饰键回车 = 「别排队，现在就插进去」。抽出来是复杂度闸门。 */
function insistsNow(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  return e.metaKey || e.ctrlKey
}

/**
 * 输入框的按键分派。
 *
 * 顺序是有讲究的：**两张候选表先吃**（它们开着的时候，回车是「选中」不是「发送」），
 * 然后才轮到回车发送。抽出来是行数闸门逼的，但也确实是独立的一件事——
 * 上面那个组件管「长什么样」，这里管「按下去谁接」。
 */
function onPromptKey(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  on: {
    mentions: ReturnType<typeof useMentions>
    slash: ReturnType<typeof useSlash>
    choose: (path: string) => void
    pickCommand: (command: SlashCommand) => void
    onSubmit: (steer: boolean) => void
  },
): void {
  if (on.slash.onKeyDown(e)) {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      const command = on.slash.hits[on.slash.active]
      if (command !== undefined) on.pickCommand(command)
    }
    return
  }
  if (on.mentions.onKeyDown(e)) {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      const path = on.mentions.paths[on.mentions.active]
      if (path !== undefined) on.choose(path)
    }
    return
  }
  // Enter 发送，Shift+Enter 换行；IME 组字期间不拦（否则中文输入会被吞）。
  // **⌘⏎ 是「别排队，现在就插进去」**——和 codex 一致（它那边也是加一个修饰键
  // 就不排队）。这个组合在输入框里是空的：审批卡那套 ⌘⏎ 见到焦点在输入框就装作没看见
  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
    e.preventDefault()
    on.mentions.close()
    on.slash.close()
    on.onSubmit(insistsNow(e))
  }
}
