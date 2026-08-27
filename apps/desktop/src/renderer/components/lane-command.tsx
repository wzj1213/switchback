import { copyFeedbackLabel, copyFeedbackTitle, useCopyFeedback } from "../use-copy-feedback.js"
import { CheckIcon, CopyIcon } from "./icons.js"

/**
 * 一条后台旁路的**命令原文**与**输出片段**——两者都是引擎自己报的，这里只负责画。
 *
 * 拆出来是因为两处都要用：转录区那张卡（`LaneCard`）和工作台的活动页
 * （列表一行 + 详情整块）。没有它的时候，一条后台任务在两处都只剩
 * 「标题 + 已完成」，看不出它到底跑了什么。
 */

/** 多行命令挤进一行：连续空白收成单空格。原文仍挂在 `title` 上，鼠标停住看得到。 */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

export function LaneCommandLine({ command }: { command: string }): React.JSX.Element {
  return <code className="lane-cmd" title={command}>{oneLine(command)}</code>
}

export function LaneCommandBlock({ command, onCopy }: {
  command: string
  onCopy: (text: string) => unknown
}): React.JSX.Element {
  const [feedback, copy] = useCopyFeedback(() => onCopy(command))
  return (
    <div className="lane-cmd-block">
      <div className="lane-cmd-block__toolbar">
        <button type="button" className="lane-cmd-block__copy" aria-live="polite"
          data-state={feedback} title={copyFeedbackTitle(feedback, "复制后台命令")} onClick={copy}>
          {feedback === "copied" ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          {copyFeedbackLabel(feedback)}
        </button>
      </div>
      <pre tabIndex={0} aria-label="可横向滚动的后台命令"><code>{command}</code></pre>
    </div>
  )
}

export function LaneOutput({ text }: { text: string }): React.JSX.Element {
  return (
    <pre className="lane-output" tabIndex={0} aria-label="可滚动的后台输出">
      <code>{text}</code>
    </pre>
  )
}
