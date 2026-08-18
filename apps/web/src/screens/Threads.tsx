import { useMemo } from "react"
import type { Thread, ThreadId } from "@omni/protocol"
import { itemsOf, projectsOf, threadRowsOf } from "@omni/store"
import type { Remote } from "../useRemote.js"
import { PushToggle } from "../components/PushToggle.js"

/**
 * 会话列表。
 *
 * **等审批的排最前**，不按时间。这一端的用途就是「它卡住了，我去放行」——
 * 而卡住的那条按时间排可能在第七位。次序是：等审批 → 在跑 → 其余按活跃度。
 */

const STATUS_TEXT: Readonly<Record<Thread["status"], string>> = {
  starting: "正在起引擎",
  idle: "空闲",
  running: "在跑",
  waiting_approval: "等你确认",
  failed: "出错了",
}

function rank(thread: Thread): number {
  if (thread.status === "waiting_approval") return 0
  if (thread.status === "running" || thread.status === "starting") return 1
  return 2
}

function lastAt(items: readonly { at: number }[]): number {
  return items[items.length - 1]?.at ?? 0
}

/** 一行会话。抽出来是因为它现在挂在分组底下，而分组本身还要能复用它。 */
function Row({
  thread,
  preview,
  count,
  selected,
  onOpen,
}: {
  thread: Thread
  preview: string | undefined
  count: number
  selected: boolean
  onOpen: (id: ThreadId) => void
}): React.JSX.Element {
  return (
    <button
      className="row"
      type="button"
      aria-current={selected}
      onClick={() => {
        onOpen(thread.id)
      }}
    >
      <span className={`dot dot--${thread.status}`} aria-hidden="true" />
      <span className="row__body">
        <span className="row__title">{thread.title}</span>
        <span className="row__sub">
          {STATUS_TEXT[thread.status]} · {thread.engine}
          {thread.detached === true ? " · 未接引擎" : ""}
        </span>
        {preview === undefined ? null : <span className="row__preview">{preview}</span>}
      </span>
      <span className="row__count">{count || ""}</span>
    </button>
  )
}

/** 基线在路上时占的位。三行，和真实行同高——到货时不跳。 */
function Skeleton(): React.JSX.Element {
  return (
    <ul className="threads__list" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <li key={i}>
          <span className="row row--skeleton">
            <span className="dot dot--skeleton" />
            <span className="row__body">
              <span className="skel skel--title" />
              <span className="skel skel--sub" />
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function Threads({
  remote,
  selected,
  onOpen,
  onUnpair,
  onNew,
  token,
}: {
  remote: Remote
  selected: ThreadId | undefined
  onOpen: (id: ThreadId) => void
  onUnpair: () => void
  onNew: () => void
  token: string
}): React.JSX.Element {
  // **挂在 state 上算一次。** 不挂的话，后台某条会话刷屏时（宿主每 16ms 推一批，
  // 每批一次 setState），前台这份列表跟着每帧重新过滤 + 重排一遍
  const rows = useMemo(
    () =>
      [...threadRowsOf(remote.state)]
        .filter((row) => row.thread.provisional !== true)
        .sort((a, b) => {
          const byRank = rank(a.thread) - rank(b.thread)
          return byRank === 0 ? b.thread.updatedAt - a.thread.updatedAt : byRank
        }),
    [remote.state],
  )
  const projects = useMemo(() => projectsOf(rows), [rows])

  return (
    <div className="threads">
      <header className="threads__head">
        <span className="threads__title">会话</span>
        {/*
          **「开一条」放在这儿，而不是藏进设置里。** 用户最早提的要求原话就是
          「手机在远程也能直接看到在本机跑的对话，并且能继续开新对话进行开发」——
          而上一版把它整个砍了，理由是「要选目录」。目录不用选：
          已经在用的那些项目就是清单（见 `NewThread`）。
        */}
        <button className="btn btn--ghost" type="button" onClick={onNew}>
          ＋ 开一条
        </button>
        <button className="btn btn--ghost" type="button" onClick={onUnpair}>
          解除配对
        </button>
      </header>
      {rows.length === 0 && !remote.hydrated ? (
        // **基线还没到 ≠ 真的没有会话。** 说后者是一句确定的假话，
        // 而用户的反应是退出重开——重开会打断正在传的那份全量，回到起点。
        // 骨架还顺带给出高度，全量到达时列表不会整块跳一下
        <Skeleton />
      ) : rows.length === 0 ? (
        <p className="empty">还没有会话。到桌面上新建一条，这里就会出现。</p>
      ) : (
        <ul className="threads__list">
          {projects.map((project) => (
            <li key={project.cwd}>
              {/*
                **按项目分组，和桌面侧栏同一条规则**（`@omni/store` 的 `projectsOf`）。
                原来这里是一条平列表——同一台机器上的同一批会话在两端长得完全不一样：
                一边分着项目，一边十几条混在一起，谁属于哪个仓库全靠标题猜。
              */}
              <p className="project">
                <span className="project__name">{project.name}</span>
                <span className="project__count">{project.rows.length}</span>
              </p>
              <ul className="threads__list">
                {project.rows.map(({ thread, preview }) => (
                  <li key={thread.id}>
                    <Row
                      thread={thread}
                      preview={preview}
                      count={itemsOf(remote.state, thread.id).length}
                      selected={thread.id === selected}
                      onOpen={onOpen}
                    />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <footer className="threads__foot">
        <PushToggle token={token} />
        {remote.me === undefined ? null : (
          <span className="threads__who">
            {remote.me.name} · 远程上限 {remote.me.maxTrust}
          </span>
        )}
      </footer>
    </div>
  )
}

/** 最后一条 item 的时间。列表暂时按 `updatedAt` 排，留着给将来更细的排序用。 */
export { lastAt }
