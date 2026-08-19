import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { Thread as ThreadModel } from "@omni/protocol"
import { itemsOf, turnOf, usageOf } from "@omni/store"
import type { Remote } from "../useRemote.js"
import { ItemView } from "../components/ItemView.js"
import { Composer } from "../components/Composer.js"
import { Reattach } from "../components/Reattach.js"
import { useStickToBottom } from "../useStickToBottom.js"

/** 上下文用量的条。引擎没报就整个不画——**没有数据时不要画一个空进度条**。 */
function Usage({ used, window: total }: { used: number; window: number | undefined }): React.JSX.Element | null {
  if (total === undefined || total === 0) return null
  const pct = Math.min(100, Math.round((used / total) * 100))
  return (
    <span className="usage" title={`上下文 ${String(used)} / ${String(total)}`}>
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
  const all = itemsOf(remote.state, thread.id)
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
  const hidden = full ? 0 : Math.max(0, all.length - FIRST_SCREEN)
  const items = hidden === 0 ? all : all.slice(hidden)
  if (all.length === 0) {
    // **正文没到 ≠ 这条会话是空的。** 分级 replay 之后「正文晚一拍到」
    // 是常态（全量只带最近几条的正文，其余打开时才补），
    // 而说「还没有内容」是一句会让人以为记录丢了的假话
    const why = remote.loaded.has(thread.id) ? "这条会话还没有内容。" : "正在取这条会话的内容…"
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
          显示更早的 {hidden} 条
        </button>
      ) : null}
      {/*
        **上面还有东西，得说出来。** 很长的会话手机上只带尾巴（见 `scope.ts`），
        不说的话它看起来就是「从中间开始的」——而人会以为记录丢了，
        跑去桌面上翻，或者干脆重开应用。
        这里只说实话，不假装能加载：往上翻加载更早的那条路还没做。
      */}
      {remote.trimmed.has(thread.id) && hidden === 0 ? (
        <p className="thread__earlier">更早的内容没有加载。完整记录在桌面上。</p>
      ) : null}
      {items.map((item) => (
        <ItemView key={item.id} item={item} send={remote.send} offline={offline} />
      ))}
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
  const usage = usageOf(remote.state, thread.id)
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

  return (
    <section className="thread">
      <header className="thread__head">
        <button className="btn btn--ghost thread__back" type="button" onClick={onBack} aria-label="返回列表">
          ‹
        </button>
        <span className="thread__title">{thread.title}</span>
        <Usage used={usage?.contextUsed ?? 0} window={usage?.contextWindow} />
      </header>
      <div className="thread__body" ref={scroller}>
        <div className="thread__inner" ref={inner}>
          <Body thread={thread} remote={remote} offline={offline} scroller={scroller} />
          {running ? <p className="thread__running">正在跑…</p> : null}
        </div>
      </div>
      {atBottom ? null : (
        <button className="tobottom" type="button" onClick={toBottom}>
          ↓ 回到底部
        </button>
      )}
      {thread.detached === true ? (
        // **没接引擎时给的是一个动作，不是一句「去桌面上点」。**
        // 手机上绝大多数会话都是 detached 的（宿主只留少数几条活的），
        // 摆一个禁用的输入框等于把这一端做成只读
        <Reattach
          thread={thread}
          ceiling={remote.me?.maxTrust ?? "auto-edit"}
          offline={offline}
          send={remote.send}
        />
      ) : (
        <Composer
          // **引擎还在起的时候也不能发。** 不禁的话回车会先清空输入框、
          // 再撞上宿主那句「会话不存在」——而那句话走的是另一条通道，
          // 手机上以前一个字都看不到（现在 `Notices` 画了，但**最好是别发生**）。
          // 桌面端早就是这条判据（`renderer/components/Composer.tsx` 的 `blocked`）
          disabled={offline || thread.status === "starting"}
          running={running}
          hint={hintOf(thread, offline)}
          onSend={(text) => remote.send({ type: "thread.prompt", threadId: thread.id, text })}
          onStop={() => {
            remote.send({ type: "thread.interrupt", threadId: thread.id })
          }}
        />
      )}
    </section>
  )
}

/** 输入框上面那行小字。**说清现在为什么不能发**，而不是只报引擎和档位。 */
function hintOf(thread: ThreadModel, offline: boolean): string {
  if (offline) return "没连上 omni，先等重连"
  if (thread.status === "starting") return "引擎正在启动，马上就能说话"
  return `${thread.engine} · ${thread.trust}`
}
