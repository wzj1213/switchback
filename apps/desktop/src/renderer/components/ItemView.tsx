import { Markdown } from "./Markdown.js"
import { Reasoning } from "./Reasoning.js"
import { Failure } from "./Failure.js"
import { Thumb } from "./ImageThumb.js"
import { Approval, type ResolveApproval } from "./Approval.js"
import { memo } from "react"
import type { Item, ToolCallItem } from "@omni/protocol"
import { PlanCard } from "./PlanCard.js"
import { LinkifiedText } from "./linkified-text.js"

/**
 * 除工具调用之外的 item。工具调用由 `ToolRun` 成组渲染——
 * 这里把它从类型上排除掉，switch 才能保持穷尽，漏一种就编译不过。
 */
/**
 * 包 `memo`：流式期间每 16ms 一次 setState，不包的话**已经定稿的每一条消息
 * 都会跟着重渲染并重新解析一遍 markdown**。实测 20 条消息的会话，
 * 一帧要花 30ms——帧预算的两倍。
 *
 * 前提是传进来的 props 引用稳定，所以 `onResolve` 在 `Transcript` 那边
 * 是 `useCallback` 的；换成行内箭头函数这个 memo 立刻失效，而且是静默失效。
 */
export const ItemView = memo(function ItemView({
  item,
  onResolve,
  approvalTurn,
  shortcutApproval,
  readOnly = false,
}: {
  item: Exclude<Item, ToolCallItem>
  onResolve: ResolveApproval
  /** 当前仍可裁决审批的轮次；历史/断开态没有。 */
  approvalTurn?: string
  /** 当前轮次最新的 pending 审批，独占全局快捷键。 */
  shortcutApproval?: string
  /** 对比页中的待批请求只展示，不可在这里落定。 */
  readOnly?: boolean
}): React.JSX.Element {
  switch (item.kind) {
    case "user_message":
      // **右对齐在这套界面里只有一个意思：这句是你说的。** 所以这里只有一种形态
      // ——omni 不再替用户往对话里塞任何东西（交接文本那条路已经删掉）
      return (
        <div className="msg--user">
          <LinkifiedText text={item.text} />
          {/* 附件要在记录里留痕：三天后回来看「当时贴的是哪张图」，靠的就是这一行。
              画的是图本身而不是文件名——文件名是落盘时生成的时间戳，
              回答不了「当时贴的是哪张」这个唯一要问的问题 */}
          {item.attachments === undefined || item.attachments.length === 0 ? null : (
            <div className="msg__attach">
              {item.attachments.map((path) => (
                <Thumb key={path} path={path} />
              ))}
            </div>
          )}
        </div>
      )
    // 用户消息保持字面量：他打的是什么就显示什么，替他解析 Markdown 是意外行为
    case "agent_message":
      return (
        <div className="msg--agent">
          <Markdown text={item.text} streaming={!item.complete} />
        </div>
      )
    case "reasoning":
      return <Reasoning text={item.text} running={!item.complete} />
    case "plan":
      return <PlanCard item={item} />
    case "approval":
      return <Approval item={item} active={item.turnId === approvalTurn} readOnly={readOnly}
        shortcut={item.id === shortcutApproval} onResolve={onResolve} />
    // **可恢复的错误不画成红框。** 实测 codex 断线重连会连发十条
    // `Reconnecting... N/5`，每条都撑成一张整宽红卡片，把正文整个挤没了——
    // 而它们说的是「还在试，你不用做什么」。压成一行灰字，
    // 真正的终态错误才配那张红卡
    case "error":
      return (
        <Failure
          text={item.message}
          soft={item.fatal !== true}
          {...(item.detail === undefined ? {} : { detail: item.detail })}
        />
      )
  }
})
