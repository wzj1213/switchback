import { useState } from "react"
import type { FileChange, ToolCallItem } from "@omni/protocol"
import { VERB, target } from "../tool.js"
import { Diff } from "./Diff.js"

/** 运行期间实时显示的尾部行数。够看清在干什么，又不至于把整屏占满。 */
const LIVE_LINES = 8

function lastLines(text: string, n: number): string {
  const lines = text.split("\n")
  return lines.length <= n ? text : lines.slice(-n).join("\n")
}

/** 有内容可展开的才做成按钮；没有的渲染成静态行，避免出现点了没反应的元素。 */
function body(item: ToolCallItem): string | undefined {
  if (item.error !== undefined && item.error !== "") return item.error
  if (item.detail.kind === "shell") return item.detail.output
  return undefined
}

/** 文件改动走结构化呈现，不走纯文本那条路。 */
function files(item: ToolCallItem): readonly FileChange[] {
  return item.detail.kind === "file_edit" ? item.detail.files : []
}

function Stat({ item }: { item: ToolCallItem }): React.JSX.Element {
  if (item.detail.kind === "file_edit" && item.status === "ok") {
    const { added, removed } = item.detail
    // 零不显示：「+4 −0」里那个 −0 不携带任何信息，只是噪声
    return (
      <span className="step__state">
        {added > 0 ? <span className="diffstat__add">+{added}</span> : null}
        {removed > 0 ? <span className="diffstat__del">−{removed}</span> : null}
      </span>
    )
  }
  return <span className={`step__state step__state--${item.status}`}>{item.status}</span>
}

/**
 * 一条工具调用。
 *
 * 跑着的时候**自动摊开输出的尾部**——一条跑三分钟的命令，如果要用户先点一下
 * 才看得到进展，那这个进展等于不存在。跑完自动收回折叠态：那时候人关心的
 * 通常只是「成没成」。
 */
function Step({ item }: { item: ToolCallItem }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const content = body(item)
  const changed = files(item)
  const live = item.status === "running" && content !== undefined && content !== ""
  const line = (
    <>
      <span className="step__verb">{VERB[item.detail.kind]}</span>
      <span className="step__target">{target(item.detail)}</span>
      <Stat item={item} />
    </>
  )
  if (changed.length > 0) {
    return (
      <>
        <button
          className={`step step--open${open ? " step--expanded" : ""}`}
          type="button"
          onClick={() => {
            setOpen((v) => !v)
          }}
        >
          {line}
        </button>
        {open ? <Diff files={changed} /> : null}
      </>
    )
  }
  if (content === undefined || content === "") return <div className="step">{line}</div>
  return (
    <>
      <button
        className={`step step--open${open ? " step--expanded" : ""}`}
        type="button"
        onClick={() => {
          setOpen((v) => !v)
        }}
      >
        {line}
      </button>
      {open ? <pre className="step__out">{content}</pre> : null}
      {!open && live ? (
        <pre className="step__out step__out--live">{lastLines(content, LIVE_LINES)}</pre>
      ) : null}
    </>
  )
}

/**
 * 一段连续的工具活动。共用一条左轨，读起来是「一段活动」而不是一摞卡片。
 * 输出默认折叠——大多数时候你只想知道做了什么、成没成。
 */
export function ToolRun({ items }: { items: readonly ToolCallItem[] }): React.JSX.Element {
  return (
    <div className="run">
      {items.map((item) => (
        <Step key={item.id} item={item} />
      ))}
    </div>
  )
}
