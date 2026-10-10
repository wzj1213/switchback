import type { Thread } from "@switchback/protocol"
import type { Remote } from "../useRemote.js"
import { Composer } from "./Composer.js"
import { Reattach } from "./Reattach.js"

/**
 * 一条会话最下面那块：接着引擎的给输入框，没接的给「接回来」。
 *
 * **没接引擎时给的是一个动作，不是一句「去桌面上点」。** 手机上绝大多数会话都是
 * detached 的（宿主只留少数几条活的），摆一个禁用的输入框等于把这一端做成只读。
 */
export function ThreadInput({
  thread,
  remote,
  running,
  offline,
}: {
  thread: Thread
  remote: Remote
  running: boolean
  offline: boolean
}): React.JSX.Element {
  const label = (id: string): string => remote.state.engines.find((engine) => engine.id === id)?.label ?? id
  if (thread.detached === true) {
    return (
      <Reattach thread={thread} ceiling={remote.me?.maxTrust ?? "auto-edit"} offline={offline} send={remote.send} label={label} />
    )
  }
  return (
    <Composer
      // **按会话分开。** 宽屏并排、或点系统通知原地换会话时这一屏不重挂：没有 key 的话，
      // 在 A 里打了一半的字切到 B 还在，点发送就发给了 B
      key={thread.id}
      // **引擎还在起的时候也不能发。** 不禁的话回车会先清空输入框、
      // 再撞上宿主那句「会话不存在」。桌面端早就是这条判据（`renderer/components/Composer.tsx` 的 `blocked`）
      disabled={offline || thread.status === "starting"}
      running={running}
      hint={hintOf(thread, offline, label)}
      onSend={(text, applied) => remote.send({
        type: "thread.prompt", threadId: thread.id, text,
        // 并进来的就是宿主现在这一版：带上它，宿主据此消费掉，桌面上不会再冒出来一遍
        ...(applied !== undefined && applied === thread.draftRevision ? { draftRevision: applied } : {}),
      })}
      onStop={() => {
        remote.send({ type: "thread.interrupt", threadId: thread.id })
      }}
      draft={{
        threadId: thread.id,
        host: { draft: thread.draft, revision: thread.draftRevision },
        restore: remote.returned?.threadId === thread.id ? remote.returned : undefined,
        onRestored: remote.takeReturned,
      }}
    />
  )
}

/** 输入框上面那行小字。**说清现在为什么不能发、发出去谁来接**，而不是只报引擎和档位。 */
function hintOf(thread: Thread, offline: boolean, label: (id: string) => string): string {
  if (offline) return "没连上 Switchback，先等重连"
  if (thread.status === "starting") return "引擎正在启动，马上就能说话"
  // 桌面上挑了别家：发出去那一刻才换，由它接着做。不说的话看着是原来那家在答
  const next = thread.nextEngine
  if (next !== undefined && next !== thread.engine) return `下一句由 ${label(next)} 接着做 · ${thread.trust}`
  return `${label(thread.engine)} · ${thread.trust}`
}
