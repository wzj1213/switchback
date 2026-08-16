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
export function useRenaming(
  onRename: (id: string, title: string) => void,
  /** 外面请求「给这一行改名」的计数器（`/rename` 命令走这条路）。变一次就进编辑态。 */
  request?: { at: number; id: string },
): RenameCtl {
  const [id, setId] = useState<string | undefined>(undefined)
  const at = request?.at ?? 0
  const target = request?.id
  // **只跟着计数器走。** 计数器进 deps、目标 id 不进——不然选中会话一变
  // 就会重新进一次编辑态，而用户只是切了个会话
  useEffect(() => {
    if (at > 0 && target !== undefined) setId(target)
  }, [at])
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
  /**
   * `null` = 用户还没碰过这个输入框。
   *
   * 用 `null` 而不是「等于原值」来表达没碰过：两者在提交时行为一样，
   * 但**在渲染上不一样**——没碰过时显示的是实时的 `value`，
   * 于是会话在改名期间吐出新内容，输入框跟着更新是对的；
   * 碰过之后就锁住用户打的字，不再被任何自动变化冲掉。
   */
  const [draft, setDraft] = useState<string | null>(null)
  /**
   * 进编辑态那一刻的值。
   *
   * **不能直接依赖 `value`**：它是 `rowLabelOf(row)` 算出来的，
   * 而那个会跟着会话的 preview 变——正在跑的会话每吐一段就变一次。
   * 原来 effect 的依赖里有 `value`，于是「模型输出了新内容」会
   * **把你打了一半的名字整个替换掉并全选**。
   */
  const seed = useRef(value)
  const input = useRef<HTMLInputElement>(null)

  // 不在编辑态时才跟着 value 走；一旦进了编辑态，种子就冻住
  useEffect(() => {
    if (!editing) seed.current = value
  }, [editing, value])

  // 进入编辑态时把草稿重置，并全选——改名通常是**整个换掉**，
  // 不是在原名字后面追加，光标停在末尾的话每次都要先全选一遍。
  // **依赖里只有 `editing`**：加了 `value` 就会被 preview 的变化反复触发
  useEffect(() => {
    if (!editing) {
      setDraft(null)
      return
    }
    setDraft(seed.current)
    const el = input.current
    if (el === null) return
    el.focus()
    el.select()
  }, [editing])

  if (!editing) return <span className="row__label">{value}</span>

  const commit = (): void => {
    const next = (draft ?? value).trim()
    if (next === "" || next === value) onCancel()
    else onCommit(next)
  }

  return (
    <input
      ref={input}
      className="row__label row__rename"
      value={draft ?? value}
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
