import { useState } from "react"
import type { EngineId, Thread, Trust } from "@omni/protocol"
import { itemsOf, threadsOf } from "@omni/store"
import { ItemView } from "./components/ItemView.js"
import { Sidebar } from "./components/Sidebar.js"
import { Composer, ENGINES, TRUSTS } from "./components/Composer.js"
import { ToolRun } from "./components/ToolRun.js"
import { groupRows } from "./group.js"
import { useOmni } from "./useOmni.js"
import { useStickToBottom } from "./useStickToBottom.js"

function labelOf<T extends { id: string; label: string }>(list: readonly T[], id: string): string {
  return list.find((x) => x.id === id)?.label ?? id
}

function TopBar({ thread }: { thread: Thread }): React.JSX.Element {
  const handedOff = thread.engineHistory.length > 1
  return (
    <header className="topbar">
      <span className="topbar__title">{thread.title}</span>
      <span className="topbar__spacer" />
      {handedOff ? (
        <span className="pill" title={thread.engineHistory.join(" → ")}>
          接力自 {labelOf(ENGINES, thread.engineHistory[0] ?? "")}
        </span>
      ) : null}
      <span className="pill pill--engine">{labelOf(ENGINES, thread.engine)}</span>
      <span className="pill">{labelOf(TRUSTS, thread.trust)}</span>
    </header>
  )
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
  const { state, send, bridgeMissing } = useOmni()
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [engine, setEngine] = useState<EngineId>("claude")
  const [trust, setTrust] = useState<Trust>("auto-edit")

  const threads = threadsOf(state)
  const thread = threads.find((t) => t.id === selectedId) ?? threads[0]
  const items = thread === undefined ? [] : itemsOf(state, thread.id)
  const scroller = useStickToBottom<HTMLDivElement>(items.length)

  if (thread === undefined) {
    return (
      <div className="shell">
        <Sidebar threads={threads} selectedId="" onSelect={setSelectedId} />
        <main className="main">
          <Notice
            fatal={bridgeMissing}
            text={
              bridgeMissing
                ? "与主进程的通道没建立（preload 未注入）。界面此时点什么都不会有反应——先查主进程日志。"
                : "正在打开工作区…"
            }
          />
        </main>
      </div>
    )
  }

  return (
    <div className="shell">
      <Sidebar threads={threads} selectedId={thread.id} onSelect={setSelectedId} />
      <main className="main">
        <TopBar thread={thread} />
        <div className="transcript" ref={scroller}>
          <div className="transcript__inner">
            {groupRows(items).map((row) =>
              row.kind === "run" ? (
                <ToolRun key={row.items[0]?.id} items={row.items} />
              ) : (
                <ItemView
                  key={row.item.id}
                  item={row.item}
                  onResolve={(itemId, allow, remember) => {
                    send({
                      type: "approval.resolve",
                      itemId,
                      allow,
                      remember: remember ? "project" : "once",
                    })
                  }}
                />
              ),
            )}
          </div>
        </div>
        <Composer
          engine={engine}
          trust={trust}
          onEngineChange={setEngine}
          onTrustChange={(next) => {
            setTrust(next)
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
