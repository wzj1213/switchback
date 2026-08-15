import { useState } from "react"
import type { Thread, Usage } from "@omni/protocol"
import { itemsOf, threadRowsOf, turnOf, usageOf } from "@omni/store"
import { Sidebar } from "./components/Sidebar.js"
import { Composer, ENGINES, TRUSTS } from "./components/Composer.js"
import { Transcript } from "./components/Transcript.js"
import { ContextMeter } from "./components/ContextMeter.js"
import { Notices } from "./components/Notices.js"
import { useOmni } from "./useOmni.js"

function labelOf<T extends { id: string; label: string }>(list: readonly T[], id: string): string {
  return list.find((x) => x.id === id)?.label ?? id
}

function TopBar({ thread, usage }: { thread: Thread; usage: Usage | undefined }): React.JSX.Element {
  const handedOff = thread.engineHistory.length > 1
  return (
    <header className="topbar">
      <span className="topbar__title">{thread.title}</span>
      <span className="topbar__spacer" />
      <ContextMeter usage={usage} />
      {handedOff ? (
        <span className="pill" title={thread.engineHistory.join(" → ")}>
          接力自 {labelOf(ENGINES, thread.engineHistory[0] ?? "")}
        </span>
      ) : null}
      {thread.detached === true ? <span className="pill pill--muted">历史记录</span> : null}
      <span className="pill pill--engine">{labelOf(ENGINES, thread.engine)}</span>
      <span className="pill">{labelOf(TRUSTS, thread.trust)}</span>
    </header>
  )
}

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

export function App(): React.JSX.Element {
  const { state, send, pickFolder, bridgeMissing } = useOmni()
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [dismissed, setDismissed] = useState<string | undefined>(undefined)

  const rows = threadRowsOf(state)
  // 关掉的是**那一条**，不是关掉整个通道：后面再来新的还要弹
  const notices = state.notices.filter((n) => n.id !== dismissed)
  const thread = rows.find((r) => r.thread.id === selectedId)?.thread ?? rows[0]?.thread
  const items = thread === undefined ? [] : itemsOf(state, thread.id)
  const turn = thread === undefined ? undefined : turnOf(state, thread.id)

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

  if (thread === undefined) {
    return (
      <div className="shell">
        <Sidebar
          rows={rows}
          selectedId=""
          onSelect={setSelectedId}
          onNew={openPicker}
          onOpenFolder={openPicker}
        />
        <main className="main">
          <Notices notices={notices} onDismiss={setDismissed} />
          <Notice fatal={bridgeMissing} text={emptyText(bridgeMissing, notices.length > 0)} />
        </main>
      </div>
    )
  }

  return (
    <div className="shell">
      <Sidebar
        rows={rows}
        selectedId={thread.id}
        onSelect={setSelectedId}
        onNew={() => {
          open(thread.cwd)
        }}
        onOpenFolder={openPicker}
      />
      <main className="main">
        <TopBar thread={thread} usage={usageOf(state, thread.id)} />
        <Notices notices={notices} onDismiss={setDismissed} />
        <Transcript thread={thread} items={items} turn={turn} send={send} />
        <Composer
          detached={thread.detached === true}
          // 两个选择器都读**当前会话**的真实值。各存一份局部状态的话，
          // 顶栏写着 Codex、选择器写着 Claude Code——一个会撒谎的控件比没有更糟。
          engine={thread.engine}
          trust={thread.trust}
          onEngineChange={(next) => {
            // 换引擎 = 在同一个工作区另开一个会话。会话中途接力（`thread.handoff`）
            // 还没实现，与其让这个下拉框点了没反应，不如让它做一件真做得到的事。
            send({
              type: "thread.create",
              cwd: thread.cwd,
              engine: next,
              trust: thread.trust,
              title: thread.title,
            })
          }}
          onTrustChange={(next) => {
            send({ type: "thread.setTrust", threadId: thread.id, trust: next })
          }}
          onSend={(text) => {
            send({ type: "thread.prompt", threadId: thread.id, text })
          }}
        />
      </main>
    </div>
  )
}
