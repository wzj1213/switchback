import type { Turn } from "@omni/protocol"

/**
 * 「工作区可能变了」的信号。
 *
 * 一轮开始与结束各变一次——引擎跑完一轮，磁盘上就不是原来那样了。
 * 凡是要问 git 的地方（工作区芯片、变更汇总卡、审核面板）都拿它当重问的节拍，
 * **而不是各自起一个定时器**：定时器要么问得太勤（每次都 spawn 一个 git），
 * 要么太懒（改完半天界面还是旧的）。
 *
 * 抽成一个函数是因为它现在有三个调用方，而算错了不会报错——
 * 只会让某一块永远不刷新，或者每帧刷新一次。
 */
export function stampOf(turn: Turn | undefined): string {
  return turn === undefined ? "idle" : `${turn.id}:${turn.status}`
}
