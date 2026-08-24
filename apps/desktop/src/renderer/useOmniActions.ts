import { NO_CAPABILITIES } from "@omni/protocol"
import type { Command, EngineInfo, Item, Thread, Turn } from "@omni/protocol"
import { labelOf } from "./components/Composer.js"
import { nextEngine } from "./engines.js"
import { toMarkdown } from "./export.js"
import { omniCommands, type OmniAction } from "./omniCommands.js"

/**
 * omni 自己能做的那几件事，装配成斜杠命令。
 *
 * **没有对象的不给**：没有分叉对手就没有 `/compare`，没在跑就没有 `/stop`，
 * 只有一家引擎就没有 `/fork`、`/handoff`。一个点了没反应的命令
 * 比没有这条命令更糟——它会让人以为自己按错了，然后再按一次。
 *
 * 从 `Workspace` 拆出来是行数闸门逼的，但这一刀顺：那边是「一屏怎么摆」，
 * 这边是「这一屏此刻能做什么」。
 */
export function useOmniActions(
  props: {
    thread: Thread
    items: readonly Item[]
    turn: Turn | undefined
    peer: Thread | undefined
    engines: readonly EngineInfo[]
    onCompare: () => void
    onCopy: (text: string) => void
    onNew: () => void
    onRename: () => void
    onSettings: () => void
    send: (command: Command) => void
  },
  extra: { onEnv: () => void; onTimeline: () => void },
): readonly OmniAction[] {
  const { thread, send } = props
  const next = nextEngine(props.engines, thread.engine)
  // **只看能力，不看引擎叫什么、也不嗅探命令名。**
  // 原来这里是 `commands.some(c => c.name === "compact")`——那意味着某家引擎
  // 哪天把命令改名叫 `condense`，omni 会默默多出一个重复入口，没有任何地方报错
  const can = thread.capabilities ?? NO_CAPABILITIES
  return omniCommands({
    onNew: props.onNew,
    onRename: props.onRename,
    onSettings: props.onSettings,
    onEnv: extra.onEnv,
    onTimeline: extra.onTimeline,
    onExport: () => {
      props.onCopy(toMarkdown(thread, props.items, labelOf(props.engines, thread.engine)))
    },
    ...(props.peer === undefined ? {} : { onCompare: props.onCompare }),
    ...(next === undefined
      ? {}
      : {
          onFork: () => {
            send({ type: "thread.fork", threadId: thread.id, to: next.id })
          },
          onHandoff: () => {
            send({ type: "thread.handoff", threadId: thread.id, to: next.id })
          },
        }),
    // **跑着的时候把入口收起来**：这条命令引擎自己会拒，而拒绝会变成转录区里
    // 一段像是模型说的英文。宿主那边是权威闸（远程端发的是同一条命令），
    // 这里只是别让人点一颗注定失败的按钮
    ...(can.compact && props.turn === undefined
      ? {
          onCompact: () => {
            send({ type: "thread.compact", threadId: thread.id })
          },
        }
      : {}),
    ...(props.turn === undefined
      ? {}
      : {
          onStop: () => {
            send({ type: "thread.interrupt", threadId: thread.id })
          },
        }),
  })
}
