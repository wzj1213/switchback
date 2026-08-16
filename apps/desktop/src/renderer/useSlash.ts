import { useCallback, useState } from "react"
import type { SlashCommand } from "@omni/protocol"
import { matchCommands, slashAt } from "./slash.js"

export interface Slash {
  /** 当前候选。空数组 = 面板不显示。 */
  hits: readonly SlashCommand[]
  active: number
  refresh: (text: string, caret: number) => void
  /** 键盘导航。返回 true 表示这次按键被面板吃掉了。 */
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean
  close: () => void
}

/**
 * `/` 命令面板的交互。
 *
 * 和 `useMentions` 长得像，但**没有异步**：命令清单早就在 store 里
 * （引擎握手时报的），筛选是纯内存的。所以这里不需要那套「核对是不是
 * 最新一次查询」的序号机制——**也就不会掉进它那个坑**
 * （`alive` ref 在 StrictMode 下被扳死，`@` 引用因此整个哑掉过）。
 */
export function useSlash(commands: readonly SlashCommand[]): Slash {
  const [hits, setHits] = useState<readonly SlashCommand[]>([])
  const [active, setActive] = useState(0)

  const close = useCallback(() => {
    setHits([])
    setActive(0)
  }, [])

  const refresh = useCallback(
    (text: string, caret: number) => {
      const slash = slashAt(text, caret)
      if (slash === undefined) {
        close()
        return
      }
      setHits(matchCommands(commands, slash.query))
      setActive(0)
    },
    [commands, close],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (hits.length === 0) return false
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActive((i) => (i + 1) % hits.length)
        return true
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setActive((i) => (i - 1 + hits.length) % hits.length)
        return true
      }
      if (e.key === "Escape") {
        e.preventDefault()
        close()
        return true
      }
      // Enter 与 Tab 都算「选中」：面板开着的时候 Enter 不该把 `/re` 当消息发出去
      return e.key === "Enter" || e.key === "Tab"
    },
    [hits, close],
  )

  return { hits, active, refresh, onKeyDown, close }
}
