import type { Item, Thread, Turn, TurnId, TurnPace } from "@switchback/protocol"
import { useCallback, useMemo, useState } from "react"
import { foldTurns, groupRows, withAsides, withEngineMarks, type Row } from "./group.js"

/** 折/展一轮。集合运算，不是这一屏的事。 */
function toggled(prev: ReadonlySet<string>, turnId: string): ReadonlySet<string> {
  const next = new Set(prev)
  if (!next.delete(turnId)) next.add(turnId)
  return next
}

/**
 * 转录区要画的行，连同「哪几轮折着」。
 *
 * 从 `Transcript` 拆出来是函数行数闸门逼的，边界也顺：这里回答「画哪些行」，
 * 那边回答「一屏怎么滚、选中之后浮什么」。
 */
export function useTranscriptRows(
  items: readonly Item[],
  turn: Turn | undefined,
  thread: Thread,
  paces?: Readonly<Record<TurnId, TurnPace>>,
): {
  rows: readonly Row[]
  folded: (turnId: string) => boolean
  onFold: (turnId: string) => void
} {
  /**
   * **你手动展开过的那几轮。**
   *
   * 存「展开的」而不是「折起的」，因为默认是折着的：过程（思考、工具）是给
   * 「它怎么得出这个」准备的，而多数时候你先要的是结论（见 `group.ts` 的 `foldTurns`）。
   * **按会话隔离**靠 `App` 给 `Workspace` 的 key，这里不用自己管。
   */
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set())
  const onFold = useCallback((turnId: string) => {
    setUnfolded((prev) => toggled(prev, turnId))
  }, [])
  // 还在跑的那一轮不折：那时候过程就是全部内容，它正一步步长出来
  const folded = useCallback(
    (turnId: string) => turnId !== turn?.id && !unfolded.has(turnId),
    [turn?.id, unfolded],
  )
  const rows = useMemo(
    // **折叠在前、插侧问与换手分界在后**：这两样都不归任何一轮，
    // 折起某一轮不该把它们一起折掉。
    // **旁路不进流里**：输入框上方那条状态带（`ActivityDock`）说的是同一件事，
    // 两处画同一条旁路，读到第二处时人要先确认「这是不是刚才那个」
    () =>
      withEngineMarks(
        withAsides(foldTurns(groupRows(items, turn?.id, thread.cwd, paces), folded), thread.asides ?? []),
        thread.segments,
      ),
    [items, turn?.id, folded, thread.asides, thread.cwd, thread.segments, paces],
  )
  return { rows, folded, onFold }
}
