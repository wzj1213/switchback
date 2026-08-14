import { useState } from "react"
import type { EngineId, Thread, Trust } from "@omni/protocol"
import { DEMO_ITEMS, DEMO_THREADS } from "./demo.js"
import { ItemView } from "./components/ItemView.js"
import { Sidebar } from "./components/Sidebar.js"
import { Composer, ENGINES, TRUSTS } from "./components/Composer.js"

function labelOf<T extends { id: string; label: string }>(
  list: readonly T[],
  id: string,
): string {
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

export function App(): React.JSX.Element {
  const [selectedId, setSelectedId] = useState(DEMO_THREADS[0]?.id ?? "")
  const [engine, setEngine] = useState<EngineId>("codex")
  const [trust, setTrust] = useState<Trust>("auto-edit")

  const thread = DEMO_THREADS.find((t) => t.id === selectedId) ?? DEMO_THREADS[0]
  if (thread === undefined) return <div>没有会话</div>

  return (
    <div className="shell">
      <Sidebar threads={DEMO_THREADS} selectedId={selectedId} onSelect={setSelectedId} />
      <main className="main">
        <TopBar thread={thread} />
        <div className="transcript">
          <div className="transcript__inner">
            {DEMO_ITEMS.map((item) => (
              <ItemView key={item.id} item={item} />
            ))}
          </div>
        </div>
        <Composer
          engine={engine}
          trust={trust}
          onEngineChange={setEngine}
          onTrustChange={setTrust}
        />
      </main>
    </div>
  )
}
