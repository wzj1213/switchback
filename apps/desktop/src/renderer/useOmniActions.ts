import type { Command, EngineInfo, Item, SlashCommand, Thread, Turn } from "@omni/protocol"
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
    /** 引擎自己报的命令。omni 不重复提供它已经有的东西。 */
    commands: readonly SlashCommand[]
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
  extra: { onEnv: () => void },
): readonly OmniAction[] {
  const { thread, send } = props
  const next = nextEngine(props.engines, thread.engine)
  // **引擎自己有 `/compact` 就不重复给**（Claude 就有）。同一件事在面板上
  // 出现两次，人会以为它们不一样，然后花时间想该点哪个
  const ownsCompact = props.commands.some((c) => /^(?:compact|autocompact)$/.test(c.name))
  return omniCommands({
    onNew: props.onNew,
    onRename: props.onRename,
    onSettings: props.onSettings,
    onEnv: extra.onEnv,
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
    ...(ownsCompact
      ? {}
      : {
          onCompact: () => {
            send({ type: "thread.compact", threadId: thread.id })
          },
        }),
    ...(props.turn === undefined
      ? {}
      : {
          onStop: () => {
            send({ type: "thread.interrupt", threadId: thread.id })
          },
        }),
  })
}
