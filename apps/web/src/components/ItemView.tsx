import { memo, useState } from "react"
import type { Command, Item, ToolCallItem, UserMessageItem, UserMessageOrigin } from "@switchback/protocol"
import { Markdown } from "./Markdown.js"
import { Approval } from "./Approval.js"
import { ToolRow } from "./ToolRow.js"

/**
 * 一条 item 怎么画。
 *
 * 八种 item 里，**手机上真正需要读全的只有四种**：模型的话、审批卡、原生提示、错误。
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

function OriginMeta({ origin }: { origin: UserMessageOrigin }): React.JSX.Element {
  if (origin === "handoff") return <div className="native__meta">历史交接</div>
  if (origin.kind === "shell") return <div className="native__meta">终端命令</div>
  if (origin.kind === "goal_continuation") return <div className="native__meta">长期目标续跑</div>
  return (
    <div className="native__meta">
      <span>定时触发</span>
      <code>{origin.schedule}</code>
      {origin.recurring ? null : <span>单次</span>}
      {origin.coalescedCount > 1 ? <span>合并 {origin.coalescedCount} 次</span> : null}
      {origin.stale ? <span>最后一次</span> : null}
    </div>
  )
}

function UserMessage({ item }: { item: UserMessageItem }): React.JSX.Element {
  const native = item.origin !== undefined
  return (
    <div className={`item ${native ? "item--native" : "item--user"}`}>
      <div className={native ? "native-message" : "bubble"}>
        {item.origin === undefined ? null : <OriginMeta origin={item.origin} />}
        {item.text === "" ? null : (
          <div className={native ? "native__text" : "bubble__text"}>{item.text}</div>
        )}
      </div>
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
  approvalTurn,
}: {
  item: Item
  send: (command: Command) => boolean
  offline: boolean
  /** 还在等裁决的那一轮（会话活着、轮次在跑）；别的轮里留着的 pending 卡只是历史。 */
  approvalTurn?: string | undefined
}): React.JSX.Element | null {
  if (item.kind === "user_message") return <UserMessage item={item} />
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
  if (item.kind === "approval") return <Approval item={item} send={send} offline={offline} active={item.turnId === approvalTurn} />
  if (item.kind === "notice") {
    return (
      <div
        className={`item item--notice item--notice-${item.level}`}
        role={item.level === "warning" ? "alert" : "status"}
      >
        {item.message}
      </div>
    )
  }
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
  return <ErrorItem item={item} />
})

/**
 * 报错那一条。可恢复的那种（重试提示、按停止之后的「已中断」）这一轮还在跑或是自己停的：
 * 画成淡字、不报成告警——红底的话手机上看着像出错了，容易误按停止或重发。和桌面端同一个口径。
 */
function ErrorItem({ item }: { item: Extract<Item, { kind: "error" }> }): React.JSX.Element {
  return (
    <div className={item.fatal ? "item item--error" : "item item--error item--soft"} role={item.fatal ? "alert" : "status"}>
      {item.message}
      {/* 引擎自己补的那句原因（codex 的 `additionalDetails`）。重连那条只有它说得清
          「为什么断了」——抬头那句 `Reconnecting... 1/5` 一个字都没说 */}
      {item.detail === undefined ? null : <p className="item__why">{item.detail}</p>}
    </div>
  )
}
