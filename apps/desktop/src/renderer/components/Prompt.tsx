import type { SlashCommand } from "@switchback/protocol"
import { MentionList } from "./MentionList.js"
import { useMentions } from "../useMentions.js"
import { useSlash } from "../useSlash.js"
import { ghostOf } from "../slash.js"
import { SlashList } from "./SlashList.js"
import { CommandToken } from "./command-token.js"
import { PromptTextarea, promptPlaceholder } from "./prompt-textarea.js"

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
  input,
  value,
  history,
  starting = false,
  queueing = false,
  steering = false,
  cwd,
  searchFiles,
  onPaste,
  onPasteText,
  commands,
  command,
  onClearCommand,
  onCommand,
  onChange,
  onSubmit,
  onAside,
  asideMode = false,
  onAsideExit,
}: {
  input: React.RefObject<HTMLTextAreaElement | null>
  value: string
  /** 历史会话先交代的那一句（发出去会怎样）。照样能打字、能发，只是占位文字换成它。 */
  history?: string
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
  /** 贴进来的图片交给附件入口，其他文件变成路径引用；默认粘贴已在 textarea 同步拦住。 */
  onPaste: (items: DataTransferItemList | null) => Promise<void>
  /** 一次大段的纯文本粘贴：折成输入框上方一枚芯片，不撑爆正文。 */
  onPasteText: (text: string) => void
  /** 这个会话能用的斜杠命令：引擎报的 ＋ Switchback 自己的。 */
  commands: readonly SlashCommand[]
  /** 已选中的引擎命令；输入框里的 value 此时只保存参数。 */
  command?: SlashCommand
  onClearCommand: () => void
  /** 选中了一条。Switchback 自己的就地执行，引擎的填进输入框等着按回车。 */
  onCommand: (command: SlashCommand) => void
  onChange: (text: string) => void
  /** 参数是「别排队，现在就插进去」（⌘⏎）。 */
  onSubmit: (steer: boolean) => void
  /** `⌥⌘⏎`：不进模式，直接把这一句当侧问发出去。 */
  onAside?: () => void
  /** 已经在侧问模式里：占位符换一句，`Esc` 退出。 */
  asideMode?: boolean
  onAsideExit?: () => void
}): React.JSX.Element {
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

  const clearCommand = (): void => {
    onClearCommand()
    requestAnimationFrame(() => input.current?.focus())
  }

  return (
    <>
      <Lists cwd={cwd} mentions={mentions} slash={slash} onPick={choose} onCommand={pickCommand} />
      {/* **灰字预览和输入框必须共用一个原点。** 它是一层贴在文本框上的镜像：
          你打的字画成透明的占住位置，后面那截灰字才落在光标正后方。
          差一个像素的内边距或字体，这层就露馅——所以两者都写 `font: inherit`、
          `padding: 0`，谁也不许单独调 */}
      <div className={`composer__field${command === undefined ? "" : " composer__field--command"}`}>
        {command === undefined ? null : <CommandToken command={command} onRemove={clearCommand} />}
        <Ghost
          typed={value}
          rest={command === undefined ? ghostOf(slash.hits[slash.active], slash.query) : ""}
        />
        <PromptTextarea
          input={input}
          value={value}
          command={command}
          placeholder={promptPlaceholder({
            command, starting, steering, queueing, aside: asideMode,
            ...(history === undefined ? {} : { history }),
          })}
          mentions={mentions}
          slash={slash}
          onChange={onChange}
          onPaste={onPaste}
          onPasteText={onPasteText}
          clearCommand={clearCommand}
          choose={choose}
          pickCommand={pickCommand}
          onSubmit={onSubmit}
          onAside={onAside}
          asideMode={asideMode}
          onAsideExit={onAsideExit}
        />
      </div>
    </>
  )
}

/** `@` 与 `/` 两张候选表。拆出来是行数闸门逼的；它们本来就是同一类东西（浮在输入框上的候选）。 */
function Lists({ cwd, mentions, slash, onPick, onCommand }: {
  cwd: string
  mentions: ReturnType<typeof useMentions>
  slash: ReturnType<typeof useSlash>
  onPick: (path: string) => void
  onCommand: (command: SlashCommand) => void
}): React.JSX.Element {
  return (
    <>
      <MentionList cwd={cwd} paths={mentions.paths} active={mentions.active} open={mentions.open}
        loading={mentions.loading} failed={mentions.failed} onPick={onPick} onRetry={mentions.retry} />
      <SlashList commands={slash.hits} query={slash.query} active={slash.active} onPick={onCommand} />
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
