import { useEffect, useRef, useState } from "react"

/**
 * 改名的控制面。做成一个对象往下传，而不是四个回调——
 * 它要穿过 `SectionList`、`GroupBlock` 两层才到得了行上，
 * 四个参数一路带下去，每加一层就多四个 props。
 */
export interface RenameCtl {
  /** 正在改的那一行。`undefined` = 没有人在改。 */
  id: string | undefined
  start: (id: string) => void
  commit: (id: string, title: string) => void
  done: () => void
}

/**
 * 谁在改名。
 *
 * **状态放在侧栏这一层，不是放在行里**：同时只能有一行在改。
 * 放在行里的话，两行同时进编辑态是可能的（右键一行、又去双击另一行），
 * 那时候回车提交的是哪一个，说不清楚。
 */
export function useRenaming(onRename: (id: string, title: string) => void): RenameCtl {
  const [id, setId] = useState<string | undefined>(undefined)
  return {
    id,
    start: setId,
    commit: (target, title) => {
      setId(undefined)
      onRename(target, title)
    },
    done: () => {
      setId(undefined)
    },
  }
}

/**
 * 就地改名。
 *
 * ## 为什么不是弹一个对话框
 *
 * 改名是个**低风险、高频、要看着上下文做**的操作：你多半是在一串相似标题
 * 之间分辨「哪个是哪个」，而对话框会把那一串盖住——恰恰盖住你要参照的东西。
 * 就地编辑让新名字长在它最终要出现的位置上。
 *
 * ## 三条规矩
 *
 * - **回车提交、Esc 撤销、失焦提交。** 失焦按提交而不是撤销：人打完字去点别处，
 *   意思是「就这样」，不是「算了」。
 * - **空名字不提交**，按撤销处理。侧栏那一行会变成一块什么都不写的空白。
 * - 名字没变就不发命令。省掉一条写进日志的空事件。
 */
export function RowName({
  value,
  editing,
  onCommit,
  onCancel,
}: {
  value: string
  editing: boolean
  onCommit: (title: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const input = useRef<HTMLInputElement>(null)

  // 进入编辑态时把草稿重置成当前值，并全选——改名通常是**整个换掉**，
  // 不是在原名字后面追加，光标停在末尾的话每次都要先全选一遍
  useEffect(() => {
    if (!editing) return
    setDraft(value)
    const el = input.current
    if (el === null) return
    el.focus()
    el.select()
  }, [editing, value])

  if (!editing) return <span className="row__label">{value}</span>

  const commit = (): void => {
    const next = draft.trim()
    if (next === "" || next === value) onCancel()
    else onCommit(next)
  }

  return (
    <input
      ref={input}
      className="row__label row__rename"
      value={draft}
      aria-label="会话名称"
      onChange={(e) => {
        setDraft(e.target.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        // 不冒泡：侧栏和全局都挂着快捷键，一个「d」不该在改名时触发别的事
        e.stopPropagation()
        if (e.key === "Enter") commit()
        if (e.key === "Escape") onCancel()
      }}
      // 点输入框不该顺带选中这一行
      onClick={(e) => {
        e.stopPropagation()
      }}
    />
  )
}
