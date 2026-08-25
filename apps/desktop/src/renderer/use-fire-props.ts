import { useMemo } from "react"
import type { Thread, Usage } from "@omni/protocol"
import type { PetKit } from "../shared/settings.js"
import type { FireProps } from "./components/PetFx.js"

/**
 * 递给开火那一层的一整包。
 *
 * ## 为什么这几行值得单开一个 hook
 *
 * **它必须是 memo 过的**，而这件事很容易在下一次改 `Workspace` 时被顺手弄丢：
 * 那是个对象字面量，而 `Pets` 是 `memo` 过的——每次渲染新造一个，那道 memo
 * 就一次都拦不住，于是流式输出时（一秒可以几十批事件）整块桌宠跟着重渲染，
 * 五个按钮的三组 ref 白挂白卸几十遍。
 *
 * 单拎出来之后，「这一包必须稳定」这条约束有了一个自己的地方待着，
 * 而不是混在 `Workspace` 那一长串 props 里当一个不起眼的对象字面量。
 */
export function useFireProps(input: {
  pets: PetKit & { on: boolean }
  thread: Thread
  usage: Usage | undefined
  running: boolean
}): FireProps {
  const { pets, thread, usage, running } = input
  const ctxRatio = ctxRatioOf(usage)
  const handsBusy = thread.status === "waiting_approval"
  return useMemo(
    () => ({
      on: pets.fire,
      threadId: thread.id,
      running,
      handsBusy,
      ctxRatio,
      foes: pets.foes,
      brass: pets.brass,
      traj: pets.traj,
      range: pets.range,
    }),
    [pets.fire, pets.foes, pets.brass, pets.traj, pets.range, thread.id, running, handsBusy, ctxRatio],
  )
}

/**
 * 上下文用了多满（0~1）。**引擎没报窗口就是 0**——没有窗口就没有「多满」可言，
 * 拿一个占用量去除一个猜出来的窗口，画出来的压力是编的。
 */
export function ctxRatioOf(usage: Usage | undefined): number {
  if (usage?.contextWindow === undefined || usage.contextWindow <= 0) return 0
  return Math.min(1, usage.contextUsed / usage.contextWindow)
}
