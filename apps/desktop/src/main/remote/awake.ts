import { powerSaveBlocker } from "electron"
import type { Event } from "@omni/protocol"
import type { Logger } from "../log.js"

/**
 * 有活在跑的时候别让机器睡。
 *
 * ## 为什么这条属于「远程」而不是通用行为
 *
 * 在桌前用的时候，机器睡了是你自己走开了，醒来接着看就行。
 * 而**远程的全部前提是「这台机器还醒着」**——它一睡，隧道断、引擎停、
 * 手机上一片空白，而你在外面完全不知道发生了什么。
 * 这是最典型的「在桌前一切正常、真要用时静默失灵」。
 *
 * ## 它挡不住什么（必须说清楚）
 *
 * `prevent-app-suspension` 只挡**空闲休眠**：它不让系统因为「没人动」而睡。
 * 它**挡不住盖上盖子**——那条路由 macOS 的 clamshell 逻辑管，
 * 接了外部显示器和电源才不睡。也挡不住手动的「睡眠」菜单。
 *
 * 所以这一层是「把能挡的挡住」，不是「保证不睡」。文档里照实写。
 *
 * ## 为什么只在有活跑的时候挡
 *
 * 一直挡着等于把这台机器的电池管理关掉，而绝大多数时候远程是开着但闲着的。
 * 判据用轮次：有一轮在跑就挡，全跑完就放。
 */

export interface Awake {
  /** 每条出去的事件过一遍。只认轮次的起止。 */
  note: (event: Event) => void
  /** 退出前放开。**必须调**，否则那个 blocker 会跟着进程一起消失得不明不白。 */
  release: () => void
}

export function createAwake(log: Logger, enabled: () => boolean): Awake {
  const running = new Set<string>()
  const state = { id: -1 }

  const hold = (): void => {
    if (state.id !== -1 || !enabled()) return
    state.id = powerSaveBlocker.start("prevent-app-suspension")
    log.write("info", "remote", "有活在跑，先不让机器空闲休眠")
  }

  const free = (): void => {
    if (state.id === -1) return
    powerSaveBlocker.stop(state.id)
    state.id = -1
    log.write("info", "remote", "活干完了，放开休眠")
  }

  return {
    note: (event) => {
      if (event.type === "turn.started") {
        running.add(event.turn.id)
        hold()
        return
      }
      if (event.type !== "turn.completed") return
      running.delete(event.turnId)
      if (running.size === 0) free()
    },
    release: free,
  }
}
