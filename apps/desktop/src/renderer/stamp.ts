import type { Item, Turn } from "@switchback/protocol"

/**
 * 「工作区可能变了」的信号。
 *
 * 一轮开始与结束各变一次——引擎跑完一轮，磁盘上就不是原来那样了。
 * 凡是要问 git 的地方（工作区芯片、变更汇总卡、审核面板）都拿它当重问的节拍，
 * **而不是各自起一个定时器**：定时器要么问得太勤（每次都 spawn 一个 git），
 * 要么太懒（改完半天界面还是旧的）。
 *
 * 抽成一个函数是因为 Git 状态、审核、变更卡与文件预览都拿它，而算错了不会报错——
 * 只会让某一块永远不刷新，或者每帧刷新一次。
 */
export function stampOf(turn: Turn | undefined, items: readonly Item[] = []): string {
  const base = turn === undefined ? "idle" : `${turn.id}:${turn.status}`
  return `${base}:${String(shellsDone(items))}`
}

/**
 * 这一屏里跑完的 shell 命令数。**它变了就重问一次 git。**
 *
 * ## 为什么单挑 shell，不是所有工具
 *
 * 只有 shell 能干一件别的工具干不了的事：**把分支换掉**。auto-edit 档下引擎
 * 自己跑一句 `git switch` 是完全正常的，而在此之前这件事**界面上完全沉默**——
 * 芯片一直显示着开会话时那个分支，直到这一轮结束才更新。中间你要是发了第二句话，
 * 它改的已经是另一个分支了，而输入框上方那一条还在说旧的。
 *
 * 编辑类工具改的是文件，只影响「脏不脏」，那一位在轮次收尾刷新足够。
 * 把所有工具都算进来的代价是**每条工具调用 spawn 一次 git**——一轮五十条就是五十次。
 *
 * ## 只数收工的
 *
 * 跑到一半的命令还没改到任何东西（或者改了一半），这时问到的是个中间态。
 * 等它落终态再问，答案才是稳定的。
 */
function shellsDone(items: readonly Item[]): number {
  let n = 0
  for (const item of items) {
    if (item.kind !== "tool_call" || item.detail.kind !== "shell") continue
    if (item.status === "running" || item.status === "pending") continue
    n += 1
  }
  return n
}
