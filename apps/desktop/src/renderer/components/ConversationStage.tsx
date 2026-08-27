import type { Command, EngineInfo, Item, Lane, TaskRun, Thread, Turn, Usage } from "@omni/protocol"
import type { PetKit } from "../../shared/settings.js"
import { useFireProps } from "../use-fire-props.js"
import { Pets } from "./Pets.js"
import { Transcript } from "./Transcript.js"

/** 正文滚动区与桌宠共用的一块“舞台”；桌宠只订阅这里真正相关的状态。 */
export function ConversationStage({
  children,
  thread,
  items,
  turn,
  tasks,
  thinkingTokens,
  lanes,
  openLane,
  onOpenLane,
  engines,
  usage,
  pets,
  stamp,
  onReveal,
  onReview,
  send,
  onCopy,
  onReuse,
}: {
  /** 输入框上方的动态状态。放进舞台，出现时只压缩正文，不移动桌宠地面。 */
  children: React.ReactNode
  thread: Thread
  items: readonly Item[]
  turn: Turn | undefined
  tasks: readonly TaskRun[]
  thinkingTokens: number | undefined
  lanes: readonly Lane[]
  openLane: string | undefined
  onOpenLane: (laneId: string) => void
  engines: readonly EngineInfo[]
  usage: Usage | undefined
  pets: PetKit & { on: boolean }
  /** 「工作区可能变了」的节拍，转录区里那张改动卡拿它当补丁的缓存键。 */
  stamp: string | undefined
  onReveal: (path: string) => void
  onReview: () => void
  send: (command: Command) => void
  onCopy: (text: string) => void
  onReuse: (text: string, attachments?: readonly string[], aside?: boolean) => void
}): React.JSX.Element {
  const running = turn?.status === "running"
  const fire = useFireProps({ pets, thread, usage, running })
  return (
    <div className={`stage${pets.on ? " stage--pets" : ""}`}>
      <Transcript
        thread={thread}
        items={items}
        turn={turn}
        tasks={tasks}
        thinkingTokens={thinkingTokens}
        lanes={lanes}
        openLane={openLane}
        onOpenLane={onOpenLane}
        stamp={stamp}
        onReveal={onReveal}
        onReview={onReview}
        send={send}
        onCopy={onCopy}
        onReuse={onReuse}
      />
      <div className="hem" aria-hidden="true" />
      {children}
      {pets.on ? (
        <Pets
          engines={engines}
          engine={thread.engine}
          running={running}
          active={thread.status === "running" || thread.status === "waiting_approval"}
          failed={thread.status === "failed"}
          profile={thread.engineProfile}
          hidden={pets.hidden}
          entryOn={pets.entry}
          fire={fire}
        />
      ) : null}
    </div>
  )
}
