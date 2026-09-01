import { useCallback, useRef, useState } from "react"
import { hasFile, type DraftBlock } from "./composer-blocks.js"

/**
 * 输入框上方那排芯片的状态。为什么是芯片而不是正文里的一行路径，
 * 见 `composer-blocks.ts` 开头。
 *
 * ## 序号为什么是自增的
 *
 * **同一个文件删掉再拖回来是新的一枚**——它的 `key` 得换，不然 React 会把
 * 新旧两枚当成同一个（移除动画、焦点都会错）。取时钟不行：两次拖拽落在同一毫秒
 * 完全可能。取路径也不行：粘贴块没有路径，而且删了再加要换身份。
 *
 * ## 号在 setState **外面**发
 *
 * 更新函数必须是纯的：StrictMode 会把它跑两遍（这个应用开着，见 `main.tsx`），
 * 在里面 `seq.current += 1` 就是一次渲染期副作用。所以这里在事件处理里
 * 先把号占掉，更新函数只负责拼数组。去重掉的那几个会让号跳空，无所谓——
 * 它只要唯一，不需要连续。
 */
export interface DraftBlocks {
  blocks: readonly DraftBlock[]
  /** 拖入 / 手选 / 工作台「引用」都走这条。已经在里面的路径不重复挂。 */
  addFiles: (paths: readonly string[]) => void
  /** 折起来的一次大段粘贴。 */
  addPaste: (text: string) => void
  remove: (id: string) => void
  clear: () => void
  /** 「改一改再发」「从待发队列取回」整份换掉。 */
  replace: (blocks: readonly DraftBlock[]) => void
}

/** 从取回的草稿里接着往下发号，不和已经在场的那几枚撞。 */
function lastSeq(blocks: readonly DraftBlock[]): number {
  return blocks.reduce((max, block) => Math.max(max, Number(block.id.slice(1)) || 0), 0)
}

export function useDraftBlocks(initial: readonly DraftBlock[] = []): DraftBlocks {
  const [blocks, setBlocks] = useState<readonly DraftBlock[]>(initial)
  const seq = useRef(lastSeq(initial))
  const take = useCallback((count: number): number => {
    const base = seq.current
    seq.current += count
    return base
  }, [])
  return {
    blocks,
    addFiles: useCallback(
      (paths) => {
        const unique = [...new Set(paths)].filter((path) => path !== "")
        if (unique.length === 0) return
        const base = take(unique.length)
        setBlocks((had) => {
          const fresh = unique
            .filter((path) => !hasFile(had, path))
            .map((path, at) => ({ id: `b${String(base + at + 1)}`, kind: "file" as const, path }))
          return fresh.length === 0 ? had : [...had, ...fresh]
        })
      },
      [take],
    ),
    addPaste: useCallback(
      (text) => {
        if (text === "") return
        const id = `b${String(take(1) + 1)}`
        setBlocks((had) => [...had, { id, kind: "paste", text }])
      },
      [take],
    ),
    remove: useCallback((id) => {
      setBlocks((had) => had.filter((block) => block.id !== id))
    }, []),
    clear: useCallback(() => {
      setBlocks([])
    }, []),
    replace: useCallback((next) => {
      setBlocks(next)
    }, []),
  }
}
