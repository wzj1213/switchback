import type { Thread, Turn } from "@omni/protocol"
import { ItemView } from "./ItemView.js"
import type { ResolveApproval } from "./Approval.js"
import { ToolRun } from "./ToolRun.js"
import { Copyable } from "./Copyable.js"
import { AsideCard } from "./aside-card.js"
import { ChevronIcon } from "./icons.js"
import { PencilIcon, ResetIcon } from "./icons-activity.js"
import type { Row } from "../group.js"
import { spent } from "../status.js"

/**
 * 转录区里的**一行**。四种形态在这里分派，`Transcript` 只管遍历。
 *
 * 从 `Transcript` 拆出来是行数闸门逼的，这一刀也顺：那边是「一屏怎么滚、
 * 折了哪几轮、选中之后浮什么」，这边是「一行长什么样」。
 */

/** 一行的 key。三种行各有各的身份来源，抽出来免得写在 JSX 里看不清。 */
export function keyOf(row: Row): string {
  if (row.kind === "turn") return `mark-${row.turnId}`
  if (row.kind === "run") return row.items[0]?.id ?? "run"
  if (row.kind === "aside") return `aside-${String(row.aside.at)}`
  return row.item.id
}

/** 选中转录区一段话之后给不给那颗「问一句」。没有输入框的对比视图不给。 */
export function canAsk(thread: Thread, hasComposer: boolean): boolean {
  return hasComposer && thread.capabilities?.sideQuestion === true
}

export function canRewind(thread: Thread, turn: Turn | undefined, readOnly: boolean): boolean {
  return !readOnly && turn === undefined && thread.detached !== true &&
    (thread.status === "idle" || thread.status === "failed") &&
    thread.capabilities?.fork === true && thread.engineHandle !== undefined
}

export const approvalShortcut = (readOnly: boolean, itemId: string | undefined): string | undefined =>
  readOnly ? undefined : itemId

/** 一行。三种形态在这里分派，`Transcript` 只管遍历。 */
export function RowView({ row, cwd, onRewind, onReuse, folded, onFold, onCopy, onResolve, approvalTurn, shortcutApproval,
  readOnly }: {
  row: Row
  /** 工作区路径。工具行据此把绝对路径写成相对的。 */
  cwd: string
  /** 从某一轮之前重来。 */
  onRewind?: (turnId: string) => void
  /** 把某条自己发过的话填回输入框，改完再发。**对比视图里没有输入框，所以可以缺席。** */
  onReuse?: (text: string, attachments?: readonly string[]) => void
  folded: boolean
  onFold: (turnId: string) => void
  onCopy: (text: string) => void
  onResolve: ResolveApproval
  approvalTurn: string | undefined
  shortcutApproval: string | undefined
  readOnly: boolean
}): React.JSX.Element {
  // 一轮的分界。codex 在提问和回答之间放一条「已处理 X」加一道细线——
  // 没有它的话，连着问三轮的 transcript 是一条看不出接缝的长流
  if (row.kind === "turn") {
    // **整条线可点**：它本来就是这一轮回答的表头，折起来天经地义。
    // 只把小箭头做成热区的话，那是个 12px 的目标，得瞄准才点得中
    return (
      <div className="turnmark__row">
        <button
          type="button"
          className="turnmark"
          data-folded={folded}
          aria-expanded={!folded}
          onClick={() => {
            onFold(row.turnId)
          }}
        >
          <span>已处理 {spent(row.ms)}</span>
          <ChevronIcon open={!folded} size={11} />
        </button>
        {/* **回到还没发生这一轮的时候。** 走错方向时唯一的出路，
          否则只能把整个会话丢掉重开——而那会连前面对的部分一起丢 */}
        {onRewind === undefined ? null : (
          <button
            type="button"
            className="act turnmark__act"
            title="新开一个会话，只带这一轮之前的原生上下文（原会话保留）"
            onClick={() => {
              onRewind(row.turnId)
            }}
          >
            <ResetIcon size={11} />
            从这里重来
          </button>
        )}
      </div>
    )
  }
  if (row.kind === "run") return <ToolRun items={row.items} cwd={cwd} />
  if (row.kind === "aside") return <AsideCard aside={row.aside} />
  /* **只有自己发过的话能改。** agent 说的话改了再发没有意义——
     那不是你的话，改完发出去等于替它编一句 */
  const mine =
    onReuse !== undefined && row.item.kind === "user_message" && row.item.origin === undefined
  return (
    <Copyable
      item={row.item}
      onCopy={onCopy}
      {...(mine
        ? {
            extra: (
              <button
                type="button"
                className="act"
                onClick={() => {
                  onReuse(
                    row.item.kind === "user_message" ? row.item.text : "",
                    row.item.kind === "user_message" ? row.item.attachments : undefined,
                  )
                }}
              >
                <PencilIcon size={11} />
                改一改再发
              </button>
            ),
          }
        : {})}
    >
      <ItemView item={row.item} approvalTurn={approvalTurn} readOnly={readOnly}
        shortcutApproval={shortcutApproval} onResolve={onResolve} />
    </Copyable>
  )
}
