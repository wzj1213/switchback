import { useState } from "react"

/**
 * 外壳自己的那点状态：选中了哪个会话、开着哪个覆盖层。
 *
 * 拆成一个 hook 不只是为了行数——**这五个值属于同一个概念**（「界面现在是什么模式」），
 * 散在 `App` 里和业务状态混在一起时，很容易在加第六个的时候忘了它们是一组的。
 * 真源仍然是 `@omni/store` 的 `ViewState`；这里存的都是**不该落盘**的东西。
 */
export interface Shell {
  /** 用户手动选中的会话。`undefined` = 跟着「最近那个」走。 */
  selectedId: string | undefined
  select: (id: string | undefined) => void
  /** 被关掉的那条故障横幅。关的是**那一条**，不是整个通道。 */
  dismissed: string | undefined
  dismiss: (id: string) => void
  finding: boolean
  setFinding: (on: boolean) => void
  comparing: boolean
  setComparing: (on: boolean) => void
  settingsOpen: boolean
  setSettingsOpen: (on: boolean) => void
  /**
   * 焦点信号。
   *
   * **是计数不是布尔**：连按两次 ⌘K 应该两次都把焦点送进筛选框，
   * 布尔在第二次不会变化，于是第二下没反应——这类「偶尔失灵」最难查。
   */
  focusFilter: number
  askFocusFilter: () => void
}

export function useShell(): Shell {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [dismissed, setDismissed] = useState<string | undefined>(undefined)
  const [finding, setFinding] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [focusFilter, setFocusFilter] = useState(0)
  return {
    selectedId,
    select: setSelectedId,
    dismissed,
    dismiss: setDismissed,
    finding,
    setFinding,
    comparing,
    setComparing,
    settingsOpen,
    setSettingsOpen,
    focusFilter,
    askFocusFilter: () => {
      setFocusFilter((n) => n + 1)
    },
  }
}
