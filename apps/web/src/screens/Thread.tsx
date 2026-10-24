import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { Thread as ThreadModel } from "@switchback/protocol"
import { itemsOf, lanesOf, mainItems, thinkingTokensOf, turnOf, usageOf } from "@switchback/store"
import type { Remote } from "../useRemote.js"
import { ItemView } from "../components/ItemView.js"
import { ThreadInput } from "../components/ThreadInput.js"
import { Queued } from "../components/Queued.js"
import { OutsideApprovals } from "../components/OutsideApprovals.js"
import { PlanBar } from "../components/PlanBar.js"
import { QuestionStack } from "../components/QuestionCard.js"
import { GoalBar } from "../components/GoalBar.js"
import { useStickToBottom } from "../useStickToBottom.js"
import { LaneCard, LegacyAside } from "../components/LaneCard.js"
import { timelineOf } from "../timeline.js"
import type { Locale } from "@switchback/i18n"
import { useMessages } from "../i18n.js"
import { THREAD } from "./Thread.messages.js"

/** 上下文用量的条。引擎没报就整个不画——**没有数据时不要画一个空进度条**。 */
function Usage({
  used,
  window: total,
}: {
  used: number
  window: number | undefined
}): React.JSX.Element | null {
  const m = useMessages(THREAD)
  if (total === undefined || total === 0) return null
  const pct = Math.min(100, Math.round((used / total) * 100))
  return (
    <span className="usage" title={m.context(used, total)}>
      <span className="usage__fill" style={{ width: `${String(pct)}%` }} />
    </span>
  )
}

/**
 * 转录区里画什么。**三种状态必须分得开**：正文还在路上、真的是空的、有内容。
 *
 * 抽出来是复杂度闸门逼的，但边界也对：外面那层管布局和滚动，这里管
 * 「现在该给人看什么」。
 */
/**
 * 一屏先挂多少条。
 *
 * **不是虚拟滚动**：那要接管滚动数学，而这一端还要同时管贴底、
 * 「回到底部」和键盘弹起时的视口变化——在没有真机的情况下做那个，
 * 出错的样子是「滚到一半跳回去」，比慢难受得多。
 *
 * 这一版只做「先挂最近这些，其余按钮点开」：点开一次就全挂上，
 * 之后的行为和以前一模一样。80 条大约是三四屏，往上翻一下就到头。
 */
const FIRST_SCREEN = 80

function runningText(thinkingTokens: number | undefined, m: (typeof THREAD)[Locale]): string {
  return thinkingTokens === undefined ? m.running : m.thinking(thinkingTokens)
}

function Body({
  thread,
  remote,
  offline,
  scroller,
}: {
  thread: ThreadModel
  remote: Remote
  offline: boolean
  /** 外面那个滚动容器。点开「更早的」之后要靠它把视口按回原处。 */
  scroller: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const all = timelineOf(
    mainItems(remote.state, thread.id),
    thread.asides ?? [],
    lanesOf(remote.state, thread.id),
  )
  const [full, setFull] = useState(false)
  // **换会话时收回去。** 不收的话，上一条会话点开过「更早的」，
  // 下一条会话一进来就把几百条全挂上——而那正是这一条要治的
  useEffect(() => {
    setFull(false)
  }, [thread.id])
  // 点开之前那一刻的高度。**在布局阶段用它把视口按回去**——
  // 内容是往上长的，不补偿的话你正在看的那一段会整块往下跑，
  // 而人刚点的是「往上看」，结果眼前的东西却换了
  const before = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    const box = scroller.current
    const was = before.current
    before.current = undefined
    if (box === null || was === undefined) return
    box.scrollTop += box.scrollHeight - was
  }, [full, scroller])
  // 只有活会话正在跑的那一轮里的审批还能裁；和桌面端 `Transcript` 同一条判据
  const approvalTurn = thread.detached === true ? undefined : turnOf(remote.state, thread.id)?.id
  const hidden = full ? 0 : Math.max(0, all.length - FIRST_SCREEN)
  const items = hidden === 0 ? all : all.slice(hidden)
  const m = useMessages(THREAD)
  if (all.length === 0) {
    // **正文没到 ≠ 这条会话是空的。** 分级 replay 之后「正文晚一拍到」
    // 是常态（全量只带最近几条的正文，其余打开时才补），
    // 而说「还没有内容」是一句会让人以为记录丢了的假话
    const why = remote.loaded.has(thread.id) ? m.empty : m.loading
    return <p className="empty">{why}</p>
  }
  return (
    <>
      {hidden > 0 ? (
        <button
          className="thread__earlier thread__earlier--btn"
          type="button"
          onClick={() => {
            before.current = scroller.current?.scrollHeight
            setFull(true)
          }}
        >
          {m.earlier(hidden)}
        </button>
      ) : null}
      {/*
        **上面还有东西，得说出来。** 很长的会话手机上只带尾巴（见 `scope.ts`），
        不说的话它看起来就是「从中间开始的」——而人会以为记录丢了，
        跑去桌面上翻，或者干脆重开应用。
        这里只说实话，不假装能加载：往上翻加载更早的那条路还没做。
      */}
      {remote.trimmed.has(thread.id) && hidden === 0 ? (
        <p className="thread__earlier">{m.trimmed}</p>
      ) : null}
      {items.map((row) => {
        if (row.kind === "item") {
          return <ItemView key={row.key} item={row.item} send={remote.send} offline={offline} approvalTurn={approvalTurn} />
        }
        if (row.kind === "aside") return <LegacyAside key={row.key} aside={row.aside} />
        return <LaneCard key={row.key} lane={row.lane} live={!offline && thread.detached !== true} />
      })}
    </>
  )
}

export function Thread({
  remote,
  thread,
  onBack,
}: {
  remote: Remote
  thread: ThreadModel
  onBack: () => void
}): React.JSX.Element {
  const turn = turnOf(remote.state, thread.id)
  const thinkingTokens = thinkingTokensOf(remote.state, thread.id)
  // nextEngine 只是下一句的去向；真正切换前，用量仍属于当前原生会话。
  const usage = usageOf(remote.state, thread.id, thread.engine)
  const { scroller, inner, atBottom, toBottom } = useStickToBottom<HTMLDivElement, HTMLDivElement>()

  // 打开一条会话就把它标成「我在看」，让宿主别为它再响一次。
  //
  // **依赖里只放 `remote.watch`（`useCallback(…, [])`，稳定），不放整个 `remote`。**
  // 后者每次渲染都是一个新对象字面量，等于没有依赖数组——而流式输出期间
  // 每收一帧都会重渲染，于是这个 effect 变成一秒几十帧的上行。
  const { watch } = remote
  useEffect(() => {
    watch(thread.id)
  }, [watch, thread.id])

  const running = thread.status === "running" || turn?.status === "running"
  const offline = remote.conn.kind !== "open"
  const m = useMessages(THREAD)

  return (
    <section className="thread">
      <header className="thread__head">
        <button
          className="btn btn--ghost thread__back"
          type="button"
          onClick={onBack}
          aria-label={m.back}
        >
          ‹
        </button>
        <span className="thread__title">{thread.title}</span>
        <Usage used={usage?.contextUsed ?? 0} window={usage?.contextWindow} />
      </header>
      <div className="thread__body" ref={scroller}>
        <div className="thread__inner" ref={inner}>
          <Body thread={thread} remote={remote} offline={offline} scroller={scroller} />
          {running ? <p className="thread__running">{runningText(thinkingTokens, m)}</p> : null}
        </div>
      </div>
      {atBottom ? null : (
        <button className="tobottom" type="button" onClick={toBottom}>
          ↓ {m.toBottom}
        </button>
      )}
      <GoalBar goal={thread.goal} />
      <PlanBar items={itemsOf(remote.state, thread.id)} />
      <OutsideApprovals approvals={thread.pendingApprovals} send={remote.send} offline={offline} now={Date.now()} />
      <QuestionStack threadId={thread.id} groups={thread.pendingQuestions} send={remote.send} offline={offline} />
      <Queued thread={thread} send={remote.send} offline={offline} />
      <ThreadInput thread={thread} remote={remote} running={running} offline={offline} />
    </section>
  )
}
