import { useState } from "react"
import type { FileChange, ToolCallItem } from "@omni/protocol"
import { shellTranscript, summarize, target, toolStatusText, VERB } from "../tool.js"
import { requestFilePreview } from "../file-preview-request.js"
import { ChevronIcon } from "./icons.js"
import { DotBoxIcon, FileIcon, GlobeIcon, PencilIcon, TerminalIcon } from "./icons-activity.js"

/** 形态 → 图标。和 `VERB` 一一对应，加一种形态时两处都要加。 */
const GLYPH: Readonly<Record<ToolCallItem["detail"]["kind"], React.JSX.Element>> = {
  shell: <TerminalIcon />,
  file_edit: <PencilIcon />,
  file_read: <FileIcon />,
  fetch: <GlobeIcon />,
  other: <DotBoxIcon />,
}
import { Diff } from "./Diff.js"
import { Output } from "./ToolOutput.js"

/** 运行期间实时显示的尾部行数。够看清在干什么，又不至于把整屏占满。 */
const LIVE_LINES = 8

function lastLines(text: string, n: number): string {
  const lines = text.split("\n")
  return lines.length <= n ? text : lines.slice(-n).join("\n")
}

/** 有内容可展开的才做成按钮；没有的渲染成静态行，避免出现点了没反应的元素。 */
function body(item: ToolCallItem): string | undefined {
  if (item.error !== undefined && item.error !== "") return item.error
  if (item.detail.kind === "shell") return shellTranscript(item.detail)
  if (item.detail.kind === "other" && item.detail.output !== undefined) {
    return typeof item.detail.output === "string"
      ? item.detail.output
      : JSON.stringify(item.detail.output, null, 2)
  }
  return undefined
}

/** 文件改动走结构化呈现，不走纯文本那条路。 */
function files(item: ToolCallItem): readonly FileChange[] {
  return item.detail.kind === "file_edit" ? item.detail.files : []
}

/**
 * 状态。
 *
 * **成功不显示。** 一屏工具行里九成是 ok，逐行写一个「成功」等于给
 * 每一行都加一份噪声；真正要人看见的是失败、被拒、中断这几种。
 * 上一版直接打印原始英文枚举，于是整个中文界面上挂着 ok / failed / denied。
 */
function Stat({ item }: { item: ToolCallItem }): React.JSX.Element | null {
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
  const label = toolStatusText(item)
  if (label === undefined) return null
  return <span className={`step__state step__state--${item.status}`}>{label}</span>
}

/** 一行的内容。抽出来是为了让 `Step` 只管「这一行是哪种形态」，不再兼管排版。 */
function StepLine({
  item,
  threadId,
  cwd,
  open,
  expandable,
}: {
  item: ToolCallItem
  threadId: string
  cwd: string
  open: boolean
  expandable: boolean
}): React.JSX.Element {
  return (
    <>
      {/* 图标替掉动词。动词进 aria-label——读屏还是要听见「执行」这两个字 */}
      <span className="step__icon" role="img" aria-label={VERB[item.detail.kind]}>
        {GLYPH[item.detail.kind]}
      </span>
      {/* 文件路径进持久工作台预览；访达定位仍留在预览页右上角。 */}
      {item.detail.kind === "file_read" && item.detail.path.trim() !== "" ? (
        <button
          type="button"
          className="step__target step__target--go"
          title={`在工作台预览\n${item.detail.path}`}
          onClick={() => {
            requestFilePreview(threadId, cwd, item.detail.kind === "file_read" ? item.detail.path : "")
          }}
        >
          {target(item.detail, cwd)}
        </button>
      ) : (
        <span className="step__target">{target(item.detail, cwd)}</span>
      )}
      <Stat item={item} />
      {/* 可展开的提示做成真元素。上一版是 `::after` 加一个 ⌄ 字形挂在
          `.step__target` 上，而那个元素带 `text-overflow: ellipsis`——
          命令一长，提示连同文字一起被省略号吃掉，有输出的行和没输出的行长得一模一样 */}
      {expandable ? (
        <span className="step__chev">
          <ChevronIcon open={open} size={12} />
        </span>
      ) : null}
    </>
  )
}

/**
 * 一条工具调用。
 *
 * 跑着的时候**自动摊开输出的尾部**——一条跑三分钟的命令，如果要用户先点一下
 * 才看得到进展，那这个进展等于不存在。跑完自动收回折叠态：那时候人关心的
 * 通常只是「成没成」。
 */
function Step({ item, threadId, cwd }: { item: ToolCallItem; threadId: string; cwd: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const content = body(item)
  const changed = files(item)
  const hasOutput = content !== undefined && content !== ""
  const expandable = changed.length > 0 || hasOutput
  const live = item.status === "running" && hasOutput

  const line = <StepLine item={item} threadId={threadId} cwd={cwd} open={open} expandable={expandable} />
  // 没东西可展开的渲染成静态行，不做成按钮——避免出现点了没反应的元素
  if (!expandable) return <div className="step">{line}</div>

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
      {open && changed.length > 0 ? <Diff files={changed} /> : null}
      {/* **改动和错误一起显示。** 上一版是 if/else：有 diff 就只画 diff，
          于是一次失败的编辑，它失败的原因永远看不见——而那正是你要看的东西 */}
      {open && hasOutput ? <Output text={content} /> : null}
      {!open && live ? (
        <pre className="step__out step__out--live">{lastLines(content, LIVE_LINES)}</pre>
      ) : null}
    </>
  )
}

/** 这一条要不要单独占一行：**没干完的、出问题的**都要。 */
function needsOwnRow(item: ToolCallItem): boolean {
  const hookOutput = item.tool.startsWith("hook/")
    && item.detail.kind === "other"
    && item.detail.output !== undefined
  // hook 的 warning/context 虽然不等于失败，却是它唯一交给用户看的结果，不能折进成功摘要。
  return item.status !== "ok" || hookOutput
}

/**
 * 一串已经做完的调用，折成一行。
 *
 * codex 就是这么做的：五个连着的工具调用不占五行，写成
 * 「编辑了文件 · 读取了文件 · 运行了命令」一行，点开才逐条摊开。
 *
 * **只折成功的。** 失败、被拒、中断的必须自己占一行——那正是你要找的东西，
 * 把它藏进一句「运行了命令」里，等于把出问题的地方藏起来。
 */
function Folded({
  items,
  threadId,
  cwd,
}: {
  items: readonly ToolCallItem[]
  threadId: string
  cwd: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  if (items.length === 1) {
    const only = items[0]
    return only === undefined ? <></> : <Step item={only} threadId={threadId} cwd={cwd} />
  }
  return (
    <>
      <button
        type="button"
        className={`step step--open${open ? " step--expanded" : ""}`}
        onClick={() => {
          setOpen((v) => !v)
        }}
      >
        <span className="step__icon">
          <DotBoxIcon />
        </span>
        <span className="step__folded">{summarize(items.map((i) => i.detail.kind))}</span>
        <span className="step__count">{items.length}</span>
        <span className="step__chev">
          <ChevronIcon open={open} size={12} />
        </span>
      </button>
      {open ? (
        <div className="run__nested">
          {items.map((item) => (
            <Step key={item.id} item={item} threadId={threadId} cwd={cwd} />
          ))}
        </div>
      ) : null}
    </>
  )
}

/**
 * 一段连续的工具活动。共用一条左轨，读起来是「一段活动」而不是一摞卡片。
 *
 * 做完的**连着折成一行**，没做完和出问题的各占一行——
 * 一屏里最该被看见的是后者。
 */
export function ToolRun({
  items,
  threadId,
  cwd,
}: {
  items: readonly ToolCallItem[]
  threadId: string
  cwd: string
}): React.JSX.Element {
  // 按「要不要单独一行」切成若干段，段内顺序不变
  const groups: { folded: boolean; items: ToolCallItem[] }[] = []
  for (const item of items) {
    const folded = !needsOwnRow(item)
    const last = groups[groups.length - 1]
    if (last?.folded === folded) last.items.push(item)
    else groups.push({ folded, items: [item] })
  }
  return (
    <div className="run">
      {groups.map((group, index) =>
        group.folded ? (
          <Folded key={group.items[0]?.id ?? index} items={group.items} threadId={threadId} cwd={cwd} />
        ) : (
          group.items.map((item) => <Step key={item.id} item={item} threadId={threadId} cwd={cwd} />)
        ),
      )}
    </div>
  )
}
