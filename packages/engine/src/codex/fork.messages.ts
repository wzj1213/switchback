import { defineMessages } from "@switchback/i18n"

/** codex 原生分叉不成的几种情况。 */
export const CODEX_FORK = defineMessages(
  {
    noTurnId: "Codex 没有返回历史边界的 turn id",
    badCount: (count: number) => `无效的 Codex 历史移除轮数：${String(count)}`,
    beforeFirst: "Codex 的公开分叉协议不能从第一轮之前创建空历史分支",
    tooFew: (turns: number, count: number) => `Codex 源会话只有 ${String(turns)} 轮，无法从末尾移除 ${String(count)} 轮`,
    noForkId: "Codex 没有返回分叉出来的会话 id",
  },
  {
    noTurnId: "Codex didn't return a turn id for the history boundary",
    badCount: (count) => `Invalid number of Codex turns to drop: ${String(count)}`,
    beforeFirst: "Codex's public fork protocol can't create an empty branch from before the first turn",
    tooFew: (turns, count) => `The source Codex thread has only ${String(turns)} turns, so ${String(count)} can't be dropped from the end`,
    noForkId: "Codex didn't return the id of the forked thread",
  },
)
