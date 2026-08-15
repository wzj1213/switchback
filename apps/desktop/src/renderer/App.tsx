import { useState } from "react"
import { itemsOf, threadRowsOf, turnOf, usageOf } from "@omni/store"
import { Sidebar } from "./components/Sidebar.js"
import { Notices } from "./components/Notices.js"
import { Workspace } from "./components/Workspace.js"
import { useOmni } from "./useOmni.js"
import { useMenuActions } from "./useMenuActions.js"
import { toMarkdown } from "./export.js"
import { ENGINES, labelOf } from "./components/Composer.js"

/**
 * 空状态说什么。
 *
 * 有故障横幅时**不能**再说「正在打开工作区…」——那是句谎话，它永远不会打开，
 * 用户会一直等下去。一个会等到天亮的加载提示比一句直白的失败更糟。
 */
function emptyText(bridgeMissing: boolean, failed: boolean): string {
  if (bridgeMissing) {
    return "与主进程的通道没建立（preload 未注入）。界面此时点什么都不会有反应——先查主进程日志。"
  }
  if (failed) return "没有可用的会话。上方的故障说明了原因；处理好之后点「＋ 新建会话」重试。"
  return "正在打开工作区…"
}

function Notice({ text, fatal }: { text: string; fatal: boolean }): React.JSX.Element {
  return (
    <div className="transcript">
      <div className="transcript__inner">
        <div className={fatal ? "error" : "reasoning"}>{text}</div>
      </div>
    </div>
  )
}

/** 选哪个会话、怎么新建。一个会话内部长什么样是 `Workspace` 的事。 */
export function App(): React.JSX.Element {
  const { state, send, pickFolder, onMenu, find, stopFind, copy, bridgeMissing } = useOmni()
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [dismissed, setDismissed] = useState<string | undefined>(undefined)
  const [finding, setFinding] = useState(false)

  const rows = threadRowsOf(state)
  // 关掉的是**那一条**，不是关掉整个通道：后面再来新的还要弹
  const notices = state.notices.filter((n) => n.id !== dismissed)
  const thread = rows.find((r) => r.thread.id === selectedId)?.thread ?? rows[0]?.thread

  // 新会话沿用当前会话的引擎与档位：换工作区不该顺带把内核也换了
  const open = (cwd: string): void => {
    send({
      type: "thread.create",
      cwd,
      engine: thread?.engine ?? "claude",
      trust: thread?.trust ?? "auto-edit",
      title: cwd.split("/").filter(Boolean).pop() ?? cwd,
    })
    setSelectedId(undefined)
  }

  const openPicker = (): void => {
    void pickFolder().then((cwd) => {
      if (cwd !== undefined) open(cwd)
    })
  }

  useMenuActions(
    onMenu,
    {
      newThread: () => {
        if (thread === undefined) openPicker()
        else open(thread.cwd)
      },
      openFolder: openPicker,
      interrupt: () => {
        if (thread !== undefined) send({ type: "thread.interrupt", threadId: thread.id })
      },
      find: () => {
        setFinding(true)
      },
      copyMarkdown: () => {
        if (thread === undefined) return
        copy(toMarkdown(thread, itemsOf(state, thread.id), labelOf(ENGINES, thread.engine)))
      },
    },
    [thread?.id, thread?.cwd, state],
  )

  const sidebar = (
    <Sidebar
      rows={rows}
      selectedId={thread?.id ?? ""}
      onSelect={setSelectedId}
      onNew={() => {
        if (thread === undefined) openPicker()
        else open(thread.cwd)
      }}
      onOpenFolder={openPicker}
      onDelete={(id) => {
        // 删的正好是当前选中的：把选择交还给「最近那个」，而不是留一个空指针
        if (id === thread?.id) setSelectedId(undefined)
        send({ type: "thread.delete", threadId: id })
      }}
    />
  )

  if (thread === undefined) {
    return (
      <div className="shell">
        {sidebar}
        <main className="main">
          <Notices notices={notices} onDismiss={setDismissed} />
          <Notice fatal={bridgeMissing} text={emptyText(bridgeMissing, notices.length > 0)} />
        </main>
      </div>
    )
  }

  return (
    <div className="shell">
      {sidebar}
      <Workspace
        thread={thread}
        items={itemsOf(state, thread.id)}
        turn={turnOf(state, thread.id)}
        usage={usageOf(state, thread.id)}
        notices={notices}
        onDismiss={setDismissed}
        finding={finding}
        onFind={find}
        onCloseFind={() => {
          setFinding(false)
          stopFind()
        }}
        onCopy={copy}
        send={send}
      />
    </div>
  )
}
