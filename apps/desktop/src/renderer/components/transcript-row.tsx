import type { Command, Thread, Turn } from "@omni/protocol"
import { ItemView } from "./ItemView.js"
import type { ResolveApproval } from "./Approval.js"
import { ToolRun } from "./ToolRun.js"
import { Copyable } from "./Copyable.js"
import { AsideCard } from "./aside-card.js"
import { LaneCard } from "./LaneCard.js"
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

/** 一行的 key。几种行各有各的身份来源，抽出来免得写在 JSX 里看不清。 */
export function keyOf(row: Row): string {
  if (row.kind === "turn") return `mark-${row.turnId}`
  if (row.kind === "run") return row.items[0]?.id ?? "run"
  if (row.kind === "aside") return `aside-${String(row.aside.at)}`
  // **拿 lane id 不拿 at**：卡片会就地更新几百次，key 跟着变的话 React 每次都重建整棵子树
  if (row.kind === "lane") return `lane-${row.lane.id}`
  return row.item.id
}

/** 选中转录区一段话之后给不给那颗「问一句」。没有输入框的对比视图不给。 */
export function canAsk(thread: Thread, hasComposer: boolean): boolean {
  return hasComposer && thread.capabilities?.sideQuestion === true
}

export function canRewind(thread: Thread, turn: Turn | undefined, readOnly: boolean): boolean {
  return !readOnly && turn === undefined && thread.detached !== true &&
    (thread.status === "idle" || thread.status === "failed") &&
    thread.capabilities?.rewind === true && thread.engineHandle !== undefined
}

/**
 * 最后一句**自己发的话**的 id。「改一改再发」只挂在它身上。
 *
 * 从后往前找，`origin` 有值的跳过：那种是接力时从上一家带过来的，
 * **不是你在这条会话里发的**，重来它没有意义（同上一版那条「只有自己发过的话能改」）。
 */
export function lastMine(rows: readonly Row[]): string | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (row?.kind !== "item") continue
    const item = row.item
    if (item.kind === "user_message" && item.origin === undefined) return item.id
  }
  return undefined
}

/**
 * 哪几条消息挂那排动作（复制）。**每一轮的最后一条回答各挂一条。**
 *
 * 上一版是给**每条消息**都挂一颗悬停才出现的「复制」，连思考和通知都有。
 * 挂着的时候它是隐形的，可它照样占着一行的高度（`opacity: 0` 不是 `display: none`），
 * 于是每两条消息之间凭空多出二十来像素，`app-main.css` 那套间距体系一档都不准。
 *
 * 收到「每轮一条」而不是「整屏一条」：**你要拿走的是某一轮的答案**，
 * 而一屏里往往压着好几轮——只留最后那一条的话，往回翻两屏就没有任何入口了。
 *
 * 三条规矩：
 *
 * - **只认回答**。人话、思考、通知、计划卡都不挂——把复制挂在一段思考上，
 *   等于说那段思考和答案是同一级的东西。（你自己那句话上挂的是「改一改再发」，
 *   那是另一件事，见 `lastMine`。）
 * - **还在吐字的不算**。那一刻没有一份定稿可拿，而按钮一旦画出来，
 *   下一帧文字长高它就往下跳一次。写完才出现。
 * - **一轮里说了好几段就归最后那段**。前面几段是过程，末尾那段才是这一轮的结论。
 */
export function answerActs(rows: readonly Row[]): ReadonlySet<string> {
  // 一轮一条：后来的覆盖先前的，收尾时留下的就是每轮最后那条
  const last = new Map<string, string>()
  for (const row of rows) {
    if (row.kind !== "item") continue
    const item = row.item
    if (item.kind !== "agent_message" || !item.complete) continue
    last.set(item.turnId, item.id)
  }
  return new Set(last.values())
}

/**
 * 「改一改再发」那颗按钮的接线。**给不出来就返回空对象**，`RowView` 据此不画。
 *
 * 抽出来是行数闸门逼的（`Transcript` 撑到了 116 行），这一刀也顺：
 * 「这一行该不该有那颗按钮、点了发什么命令」本来就不是「一屏怎么滚」的事。
 */
export function retryProps(
  row: Row,
  on: { active: boolean; id: string | undefined; threadId: string; send: (command: Command) => void },
): { onRetry?: () => void } {
  if (!on.active || row.kind !== "item" || row.item.id !== on.id) return {}
  const item = row.item
  if (item.kind !== "user_message") return {}
  return {
    onRetry: () => {
      on.send({
        type: "thread.rewind",
        threadId: on.threadId,
        turnId: item.turnId,
        // 回到这一句之前，并把这一句原样交还到新会话的输入框
        draft: item.text,
        ...(item.attachments === undefined ? {} : { draftAttachments: item.attachments }),
      })
    },
  }
}

export const approvalShortcut = (readOnly: boolean, itemId: string | undefined): string | undefined =>
  readOnly ? undefined : itemId

/** 一行。三种形态在这里分派，`Transcript` 只管遍历。 */
export function RowView({ row, threadId, cwd, acts, onRewind, onRetry, folded, onFold, onCopy, onResolve, approvalTurn, shortcutApproval,
  readOnly, openLane, onOpenLane, laneLive }: {
  row: Row
  /** 这一行是不是「最后一条说出来的话」。见 `lastSpoken`。 */
  acts: boolean
  threadId: string
  /** 工作区路径。工具行据此把绝对路径写成相对的。 */
  cwd: string
  /** 从某一轮之前重来。 */
  onRewind?: (turnId: string) => void
  /**
   * 「改一改再发」。**只挂在最后一句人话上**，而且它是个 rewind：
   * 回到那一句之前，再把原话交还到输入框。给了才画那颗按钮。
   */
  onRetry?: () => void
  folded: boolean
  onFold: (turnId: string) => void
  onCopy: (text: string) => void
  onResolve: ResolveApproval
  approvalTurn: string | undefined
  shortcutApproval: string | undefined
  readOnly: boolean
  /** 工作台正开着哪条旁路。**注意和上面那个 `folded` 不是一回事**：那个是折轮次。 */
  openLane?: string | undefined
  onOpenLane?: ((laneId: string) => void) | undefined
  /** 历史线程里的 running 只是最后快照；没接回引擎前不能继续转圈。 */
  laneLive: boolean
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
  if (row.kind === "run") return <ToolRun items={row.items} threadId={threadId} cwd={cwd} />
  if (row.kind === "aside") return <AsideCard aside={row.aside} />
  if (row.kind === "lane") {
    return (
      <LaneCard
        lane={row.lane}
        live={laneLive}
        folded={openLane === row.lane.id}
        {...(onOpenLane === undefined ? {} : { onOpen: onOpenLane })}
      />
    )
  }
  /*
   * 「改一改再发」**只挂在最后一句人话上，而且只在能 rewind 的时候**。
   *
   * 上一版是给每一句人话都挂，点了只是把文字复制回输入框——原来那句**原样留在
   * 转录区里**，你再发一次就成了两条几乎一样的消息。而它既然叫「改一改**再发**」，
   * 就该是把那一次重来一遍，不是在后面追加一条。
   *
   * 重来只对最后一句成立：更早的那些，中间还压着好几轮，
   * 那是「从这里重来」（轮次分隔线上那颗）该管的事，它自己会说清楚要丢掉什么。
   *
   * 能不能 rewind 由 `canRewind` 定（引擎报不报原生 fork、这一轮跑完没有……）。
   * 不能的时候**不画**——画一颗点了会炸的按钮比没有更糟。
   */
  return (
    <Copyable
      item={row.item}
      acts={acts}
      onCopy={onCopy}
      {...(onRetry === undefined
        ? {}
        : {
            extra: (
              <button
                type="button"
                className="act"
                title="回到发这句话之前，把它交还给你改；原会话保留"
                onClick={onRetry}
              >
                <PencilIcon size={11} />
                改一改再发
              </button>
            ),
          })}
    >
      <ItemView item={row.item} approvalTurn={approvalTurn} readOnly={readOnly}
        shortcutApproval={shortcutApproval} onResolve={onResolve} />
    </Copyable>
  )
}
