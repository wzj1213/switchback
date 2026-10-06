import { useEffect, useMemo, useRef, useState } from "react"
import type { ThreadRow } from "@switchback/store"
import type { ThreadStatus } from "@switchback/protocol"
import { stepUnread } from "./unread.js"
import type { SidebarRow } from "./sidebar.js"

/** 一个都没有时**始终是同一个空集合**：换引用就等于每帧都「变了」。 */
const NONE: ReadonlySet<string> = new Set()

/**
 * 给侧栏的行标上「它在你没看的时候跑完了」。判据全在 `unread.ts`，这里只管接线。
 *
 * ## 为什么在 effect 里翻面，而不是渲染时算
 *
 * 判据是**两帧之间的差**（跑着 → 空闲），需要记住上一帧。渲染函数里写 ref
 * 是错的：React 可以丢弃一次渲染结果，那样这次翻面就被吃掉了，
 * 而它恰恰是唯一一次能观察到的。
 *
 * 集合没变化时 `stepUnread` 原样还回同一个引用，所以这里的 `setState`
 * 不会自我触发——依赖里带着每帧新造的 `rows` 也不会转成死循环。
 */
export function useUnread(
  rows: readonly ThreadRow[],
  selected: string | undefined,
): readonly SidebarRow[] {
  const was = useRef<ReadonlyMap<string, ThreadStatus>>(new Map())
  const [unread, setUnread] = useState<ReadonlySet<string>>(NONE)

  useEffect(() => {
    const next = stepUnread({
      was: was.current,
      now: rows.map((row) => ({ id: row.thread.id, status: row.thread.status })),
      selected,
      unread,
    })
    was.current = next.was
    if (next.unread !== unread) setUnread(next.unread)
  }, [rows, selected, unread])

  // 一个未读都没有的时候把原数组原样传下去：侧栏那几层都在比引用
  return useMemo(
    () => (unread.size === 0 ? rows : rows.map((row) => (unread.has(row.thread.id) ? { ...row, unread: true } : row))),
    [rows, unread],
  )
}
