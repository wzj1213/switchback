import { memo, useState } from "react"
import type { Command, Item, ToolCallItem } from "@omni/protocol"
import { Markdown } from "./Markdown.js"
import { Approval } from "./Approval.js"
import { ToolRow } from "./ToolRow.js"

/**
 * 一条 item 怎么画。
 *
 * 七种 item 里，**手机上真正需要读全的只有三种**：模型的话、审批卡、错误。
 * 思考默认折起来（它长、且多数时候是过程噪声），工具调用收成一行
 * （要看输出再点开）。这不是偷懒——一块 390 点宽的屏幕上，把七种东西
 * 一样重地摊开，等于什么都读不到。
 */

function Reasoning({ text, complete }: { text: string; complete: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="item item--reasoning">
      <button className="fold" type="button" onClick={() => { setOpen(!open) }} aria-expanded={open}>
        <span className="fold__caret" data-open={open} aria-hidden="true">
          ›
        </span>
        思考{complete ? "" : "中…"}
      </button>
      {open ? <pre className="reasoning__text">{text}</pre> : null}
    </div>
  )
}

/**
 * **包了 `memo`。** 流式期间宿主每 16ms 推一批，每批一次 `setState`——
 * 不包的话，一条 80 条 item 的会话每帧都要把所有长回答重新过一遍
 * react-markdown。桌面端那侧有实测数字：20 条消息一帧 30ms，帧预算的两倍；
 * 而手机的单核大约是那台机器的三分之一。
 *
 * 它能生效靠的是归约器那边的引用稳定性：`patchItem` 只 `[...list]` 换掉命中
 * 那一格，没变的 `Item` 保持同一个对象。所以**不需要自定义比较器**——
 * 而自定义比较器一旦写错就是「界面停在旧内容上」，那比慢难查得多。
 */
export const ItemView = memo(function ItemView({
  item,
  send,
  offline,
}: {
  item: Item
  send: (command: Command) => boolean
  offline: boolean
}): React.JSX.Element | null {
  if (item.kind === "user_message") {
    return (
      <div className="item item--user">
        <div className="bubble">{item.text}</div>
      </div>
    )
  }
  if (item.kind === "agent_message") {
    return (
      <div className="item item--agent">
        <Markdown text={item.text} />
        {item.complete ? null : <span className="caret" aria-hidden="true" />}
      </div>
    )
  }
  if (item.kind === "reasoning") return <Reasoning text={item.text} complete={item.complete} />
  if (item.kind === "tool_call") return <ToolRow item={item satisfies ToolCallItem} />
  if (item.kind === "approval") return <Approval item={item} send={send} offline={offline} />
  if (item.kind === "plan") {
    return (
      <div className="item">
        {/* 引擎自己写的一句理由，报了才有（目前只有 codex 报） */}
        {item.explanation === undefined ? null : <p className="plan__note">{item.explanation}</p>}
        <ol className="item--plan">
          {item.steps.map((step, i) => (
            <li key={`${String(i)}-${step.text}`} data-status={step.status}>
              {step.text}
            </li>
          ))}
        </ol>
      </div>
    )
  }
  return (
    <div className="item item--error" role="alert">
      {item.message}
      {/* 引擎自己补的那句原因（codex 的 `additionalDetails`）。重连那条只有它说得清
          「为什么断了」——抬头那句 `Reconnecting... 1/5` 一个字都没说 */}
      {item.detail === undefined ? null : <p className="item__why">{item.detail}</p>}
    </div>
  )
})
