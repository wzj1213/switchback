import { useCallback, useEffect, useRef, useState } from "react"
import { applyMention, mentionAt } from "./mention.js"

export interface Mentions {
  /** 当前候选。空数组表示不显示列表。 */
  paths: readonly string[]
  active: number
  /** 输入或移动光标之后调用，决定要不要弹列表 */
  refresh: (text: string, caret: number) => void
  /** 键盘导航。返回 true 表示这次按键被列表吃掉了，调用方不要再处理。 */
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean
  /** 选中一条，返回替换后的文本与光标位置 */
  pick: (path: string, text: string, caret: number) => { text: string; caret: number } | undefined
  close: () => void
}

/**
 * `@` 文件引用的交互。
 *
 * 搜索是异步的，所以每次结果回来都要**核对它是不是最新那次查询的**——
 * 打字比磁盘快，先发的请求后回来是常态，不核对的话列表会闪回旧结果。
 */
export function useMentions(cwd: string, search: (cwd: string, query: string) => Promise<readonly string[]>): Mentions {
  const [paths, setPaths] = useState<readonly string[]>([])
  const [active, setActive] = useState(0)
  const seq = useRef(0)
  const alive = useRef(true)

  /**
   * **挂载时把 `alive` 扳回 true，不能只在卸载时扳成 false。**
   *
   * `StrictMode` 下 effect 会跑两遍：挂载 → 清理 → 再挂载。
   * 只写清理的话，第二次挂载后 `alive.current` 永远停在 `false`——
   * 于是**每一条搜索结果都被当成「组件已经没了」丢掉**，
   * `@` 引用的候选列表从头到尾是空的。
   *
   * 而这件事一点都不吵：搜索发出去了、主进程也老老实实返回了路径
   * （实测直接调桥能拿到三条），只是结果在最后一步被扔了。
   */
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const close = useCallback(() => {
    seq.current += 1
    setPaths([])
    setActive(0)
  }, [])

  const refresh = useCallback(
    (text: string, caret: number) => {
      const mention = mentionAt(text, caret)
      if (mention === undefined) {
        close()
        return
      }
      seq.current += 1
      const mine = seq.current
      void search(cwd, mention.query).then((found) => {
        // 打字比磁盘快：先发后回是常态，不核对序号列表会闪回旧结果
        if (!alive.current || mine !== seq.current) return
        setPaths(found)
        setActive(0)
      })
    },
    [cwd, search, close],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (paths.length === 0) return false
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActive((i) => (i + 1) % paths.length)
        return true
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setActive((i) => (i - 1 + paths.length) % paths.length)
        return true
      }
      if (e.key === "Escape") {
        e.preventDefault()
        close()
        return true
      }
      // Enter 与 Tab 都算「选中」：列表开着的时候 Enter 不该把消息发出去
      return e.key === "Enter" || e.key === "Tab"
    },
    [paths, close],
  )

  const pick = useCallback(
    (path: string, text: string, caret: number) => {
      const mention = mentionAt(text, caret)
      if (mention === undefined) return undefined
      close()
      return applyMention(text, mention, path)
    },
    [close],
  )

  return { paths, active, refresh, onKeyDown, pick, close }
}
