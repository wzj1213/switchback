import { powerSaveBlocker } from "electron"
import type { Thread } from "@switchback/protocol"

/**
 * 有活在跑的时候，别让机器闲着闲着就睡过去。
 *
 * ## 它治的是什么
 *
 * 交代一件事、切走、去开个会——回来发现它停在 40%。不是崩了，是系统闲置待机
 * 把整个进程冻住了。这件事**只有主进程能处理**，而它一行代码都没有过
 *（全仓 `powerSaveBlocker` / `powerMonitor` 零命中）。
 *
 * ## 三条边界，写在这儿免得日后越界
 *
 * - **只挡「闲置待机」，不挡屏幕休眠**（`prevent-app-suspension` 而不是
 *   `prevent-display-sleep`）。后者会让笔记本亮一整夜——那是把一个小问题
 *   换成一个更烦人的问题。
 * - **合上盖子照样睡。** macOS 的 clamshell sleep 没有任何电源断言拦得住，
 *   所以文案里不能写「合上盖子也接着跑」——那是给不出的承诺。
 * - **跑完立刻放开。** 长期挂着就成了「装了 Switchback 之后我的笔记本再也不睡了」，
 *   那会让人卸载它。所以判据不用计数器（漏一条 `turn.completed` 就永远挂着），
 *   而是每次事件之后**重新看一遍现在还有没有活着的活**。
 */

/** 等审批或原生问题也算——那时引擎进程还在等人，睡过去照样断。 */
export function busy(threads: readonly Thread[]): boolean {
  return threads.some(
    (thread) =>
      thread.status === "running" ||
      thread.status === "waiting_approval" ||
      (thread.pendingQuestions?.length ?? 0) > 0,
  )
}

export interface Awake {
  /** 每次事件之后重算一遍。**幂等**：状态没变就什么都不做。 */
  sync: (threads: readonly Thread[]) => void
  /** 退出前放开。留着一个没停的断言，等于让机器一直不睡。 */
  release: () => void
}

/**
 * `powerSaveBlocker` 的那三个方法。
 *
 * 抽出来只为了**能测**：「不会同时攥着两个」和「安静下来一定放开」是这个模块的
 * 全部内容，而它们错了不报错——只是机器再也不睡，等到发现已经是几天之后。
 * 测试环境里 `electron` 不是真的模块，碰一下就 undefined。
 */
export interface Blocker {
  start: (type: "prevent-app-suspension") => number
  isStarted: (id: number) => boolean
  stop: (id: number) => void
}

export function createAwake(blocker: Blocker = powerSaveBlocker): Awake {
  const held: { id: number | undefined } = { id: undefined }
  const release = (): void => {
    if (held.id === undefined) return
    // `isStarted` 挡的是重复 stop：断言可能已经被系统回收了
    if (blocker.isStarted(held.id)) blocker.stop(held.id)
    held.id = undefined
  }
  return {
    sync: (threads) => {
      const need = busy(threads)
      // **已经攥着就不再要一个。** 每条事件都会走到这儿，一轮下来是几百次；
      // 少这一句就是几百个攥在手里、再也放不掉的断言
      if (need && held.id === undefined) {
        held.id = blocker.start("prevent-app-suspension")
        return
      }
      if (!need) release()
    },
    release,
  }
}
