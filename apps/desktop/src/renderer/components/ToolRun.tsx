import { useState } from "react"
import type { ToolCallItem } from "@switchback/protocol"
import { summarize } from "../tool.js"
import { ChevronIcon } from "./icons.js"
import { DotBoxIcon } from "./icons-activity.js"
import { useLocale } from "../i18n.js"
import { Step } from "./tool-step.js"

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
  const locale = useLocale()
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
        <span className="step__folded">{summarize(items.map((i) => i.detail.kind), locale)}</span>
        <span className="step__count">{items.length}</span>
        <span className="step__chev">
          <ChevronIcon open={open} size={14} />
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
