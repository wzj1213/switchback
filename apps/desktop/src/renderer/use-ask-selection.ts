import { useEffect, useRef, useState } from "react"

/** 引文的上限。整段贴进输入框读不动，而侧问要的是「哪一句」，不是「哪一屏」。 */
const MAX = 120

/** 选中的那段话，压成一句能放进输入框的引文。 */
export function quoteOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length <= MAX ? flat : `${flat.slice(0, MAX)}…`
}

/**
 * 选中转录区的一段话之后浮出来的那颗「问一句」。
 *
 * ## 为什么值得单开一条路
 *
 * 侧问最常见的那一句本来就是「**屏幕上这段是什么意思**」。让人先把那段话
 * 复述一遍再问，是在收一笔本来不用收的税——选中就问把上下文变成隐含的。
 *
 * ## 三个实现上的坑
 *
 * 1. **`selectionchange` 一次拖动能烧几十下。** 合进 rAF，一帧最多算一次。
 * 2. **只认转录区里的选中。** 输入框里划一段字也会触发 `selectionchange`，
 *    那时候浮一颗「问一句」出来是莫名其妙的。
 * 3. **按下去之前不能让选中消失。** 按钮上的 `pointerdown` 默认会清掉选区，
 *    于是按钮在 `click` 到达之前就没了——所以调用处要 `preventDefault`。
 */
export function useAskSelection(
  root: React.RefObject<HTMLElement | null>,
  enabled: boolean,
): { quote: string; x: number; y: number } | undefined {
  const [pick, setPick] = useState<{ quote: string; x: number; y: number }>()
  const raf = useRef(0)
  useEffect(() => {
    if (!enabled) {
      setPick(undefined)
      return
    }
    const read = (): void => {
      raf.current = 0
      const selection = document.getSelection()
      const host = root.current
      if (selection === null || host === null || selection.isCollapsed || selection.rangeCount === 0) {
        setPick(undefined)
        return
      }
      const range = selection.getRangeAt(0)
      if (!host.contains(range.commonAncestorContainer)) {
        setPick(undefined)
        return
      }
      const quote = quoteOf(selection.toString())
      if (quote === "") {
        setPick(undefined)
        return
      }
      const rect = range.getBoundingClientRect()
      setPick({ quote, x: rect.left + rect.width / 2, y: rect.top - 6 })
    }
    const onChange = (): void => {
      if (raf.current !== 0) return
      raf.current = requestAnimationFrame(read)
    }
    document.addEventListener("selectionchange", onChange)
    return () => {
      document.removeEventListener("selectionchange", onChange)
      if (raf.current !== 0) cancelAnimationFrame(raf.current)
      raf.current = 0
    }
  }, [enabled, root])
  return pick
}
