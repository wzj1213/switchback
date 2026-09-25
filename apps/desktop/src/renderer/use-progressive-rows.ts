import { startTransition, useEffect, useState } from "react"

/**
 * 长会话**先画末尾，其余空闲时往上补齐**。
 *
 * ## 为什么
 *
 * 切到一条几百轮的会话，原来是一次同步挂满整段历史：每条回答都要走一遍
 * Markdown 解析和代码高亮，再建出几万个 DOM 节点。400 轮的样本上
 * 点下去到下一帧 300–440ms，其中 Markdown 就占 156ms——点侧栏像是卡住了。
 * 而打开会话时视口停在底部，那一刻真正看得见的只有最后几十行。
 *
 * ## 怎么补
 *
 * 首屏挂末尾 `FIRST` 行；之后每个空闲片往上补 `STEP` 行，放在 transition 里，
 * 用户这时候点别的、打字，React 会先让路。补的都是视口**上方**的内容：
 * 贴底时 `useStickToBottom` 的尺寸跟随把视图钉在底部，翻上去时靠浏览器的
 * 滚动锚定保住正在看的那一行。
 *
 * ## 查找要全量
 *
 * 会话内查找用的是 Chromium 原生 `findInPage`，只认 DOM 里的文字。
 * 查找条一开（`full`），剩下的一次挂完，命中数不会少算。
 * 下限是**下标**不是「距末尾几行」：流式期间新行追加在末尾，不该把顶上已挂的行挤掉。
 */
export const FIRST = 40
export const STEP = 60

/** 刚打开时从哪一行开始挂。短会话直接全量。 */
export function firstFloor(total: number): number {
  return Math.max(0, total - FIRST)
}

/** 补一片之后的下限。 */
export function nextFloor(floor: number): number {
  return Math.max(0, floor - STEP)
}

/**
 * 这一帧实际挂哪几行。`full` 时全量。
 * 行数比记下的下限还少（折起了几轮）时退回「末尾 `FIRST` 行」，不因此一次挂满。
 */
export function mountedRows<T>(rows: readonly T[], floor: number, full: boolean): readonly T[] {
  const start = full ? 0 : Math.min(floor, firstFloor(rows.length))
  return start <= 0 ? rows : rows.slice(start)
}

export function useProgressiveRows<T>(rows: readonly T[], full: boolean): readonly T[] {
  const [floor, setFloor] = useState(() => firstFloor(rows.length))
  const pending = !full && floor > 0
  useEffect(() => {
    if (!pending) return undefined
    // 空闲回调给一个上限：一直忙（流式输出）时也要在半秒内补一片，不能永远停在半截
    const id = requestIdleCallback(() => {
      startTransition(() => { setFloor(nextFloor) })
    }, { timeout: 500 })
    return () => { cancelIdleCallback(id) }
  }, [pending, floor])
  // 查找打开过一次就不再回到分片：关掉查找时把已挂满的内容卸掉只会白做一遍
  useEffect(() => {
    if (full) setFloor(0)
  }, [full])
  return mountedRows(rows, floor, full)
}
