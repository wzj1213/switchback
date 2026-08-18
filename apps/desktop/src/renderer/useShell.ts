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
  /**
   * 已经关掉的故障横幅。
   *
   * **是集合不是单个 id。** 上一版只记最后一个，于是同时挂着两条时，
   * 关掉 A → 记住 A → B 显示 → 关掉 B → 记住 B → **A 又回来了**，
   * 那个 × 在两条之间无限来回，永远关不干净。
   */
  dismissed: ReadonlySet<string>
  dismiss: (id: string) => void
  finding: boolean
  setFinding: (on: boolean) => void
  comparing: boolean
  setComparing: (on: boolean) => void
  settingsOpen: boolean
  setSettingsOpen: (on: boolean) => void
  /** 审核面板开着没有。和设置同层：一块盖住界面的面板，Esc 关。 */
  reviewOpen: boolean
  setReviewOpen: (on: boolean) => void
  /**
   * 焦点信号。
   *
   * **是计数不是布尔**：连按两次 ⌘K 应该两次都把焦点送进筛选框，
   * 布尔在第二次不会变化，于是第二下没反应——这类「偶尔失灵」最难查。
   */
  focusFilter: number
  askFocusFilter: () => void
  /**
   * 变一次就让侧栏把当前那一行切进改名态。
   *
   * 用计数器而不是布尔：布尔要有人负责复位，而「谁来复位」在两个组件之间
   * 说不清楚——`focusFilter` 当初就是为这个改成计数器的，这里照抄。
   */
  askRename: number
  requestRename: () => void
}

export function useShell(): Shell {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const [finding, setFinding] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [focusFilter, setFocusFilter] = useState(0)
  const [askRename, setAskRename] = useState(0)
  return {
    selectedId,
    select: setSelectedId,
    dismissed,
    dismiss: (id) => {
      setDismissed((prev) => new Set(prev).add(id))
    },
    finding,
    setFinding,
    comparing,
    setComparing,
    settingsOpen,
    setSettingsOpen,
    reviewOpen,
    setReviewOpen,
    askRename,
    requestRename: () => {
      setAskRename((n) => n + 1)
    },
    focusFilter,
    askFocusFilter: () => {
      setFocusFilter((n) => n + 1)
    },
  }
}
