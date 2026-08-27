import { useEffect, useRef, useState } from "react"
import { CloseIcon } from "./icons-panel.js"

export interface FindResult {
  active: number
  total: number
}

interface Props {
  onFind: (query: string, next: boolean, forward: boolean) => Promise<FindResult>
  onClose: () => void
}

/**
 * 会话内查找条。
 *
 * 计数用 `n/总数` 而不是「找到 N 条」——**知道自己在第几条**才敢一直按回车，
 * 只给总数的话人会数不清自己转了几圈。
 */
export function FindBar({ onFind, onClose }: Props): React.JSX.Element {
  const [query, setQuery] = useState("")
  const [result, setResult] = useState<FindResult>({ active: 0, total: 0 })
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
    // 开发钩子：自动化截图按不了键，从主进程把查找词塞进来
    return window.omni?.onDevFind((q) => {
      setQuery(q)
    })
  }, [])

  // 输入即查；空串由主进程负责清掉高亮
  useEffect(() => {
    let alive = true
    void onFind(query, false, true).then((r) => {
      if (alive) setResult(r)
    })
    return () => {
      alive = false
    }
  }, [query, onFind])

  const step = (forward: boolean): void => {
    if (query === "") return
    void onFind(query, true, forward).then(setResult)
  }

  const empty = query !== "" && result.total === 0
  return (
    <div className="findbar">
      <input
        ref={input}
        className={`findbar__input${empty ? " findbar__input--empty" : ""}`}
        placeholder="在会话中查找…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose()
          // Enter 下一个，Shift+Enter 上一个——和所有编辑器一致，不要发明新的
          else if (e.key === "Enter") step(!e.shiftKey)
        }}
      />
      <span
        className="findbar__count"
        title="计数覆盖整个窗口，含侧栏的会话预览与查找框自身"
      >
        {query === "" ? "" : `${String(result.active)}/${String(result.total)}`}
      </span>
      <button className="findbar__btn" type="button" aria-label="上一个" onClick={() => { step(false) }}>
        ↑
      </button>
      <button className="findbar__btn" type="button" aria-label="下一个" onClick={() => { step(true) }}>
        ↓
      </button>
      <button className="findbar__btn" type="button" aria-label="关闭查找" data-tip="关闭查找（Esc）" onClick={onClose}>
        <CloseIcon size={14} />
      </button>
    </div>
  )
}
