import { useCallback, useEffect, useState } from "react"
import { onFilePreviewRequest } from "./file-preview-request.js"
import { onTurnReviewRequest, type TurnReviewTarget } from "./turn-review.js"
import {
  CLOSED_WORKBENCH,
  navigateFile,
  showActivity,
  showActivityIndex,
  showFile,
  showFileIndex,
  showFiles,
  showLane,
  type PreviewTarget,
  type WorkbenchState,
} from "./workbench.js"
import {
  CLOSED_PANEL,
  closePanelTab,
  hasPanelTab,
  hidePanel,
  openPanel,
  togglePanel,
  togglePanelFull,
  type PanelPage,
} from "./panel-state.js"

/**
 * 外壳自己的那点状态：选中了哪个会话、开着哪个工具组或覆盖层。
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
  /**
   * 左侧导航展开着没有。**默认展开**——收起是一个显式动作，
   * 不是启动时的默认状态；一个新用户打开应用应该先看见有什么。
   */
  railOpen: boolean
  toggleRail: () => void
  settingsOpen: boolean
  setSettingsOpen: (on: boolean) => void
  /** 审核页签已经打开；切去别页时仍挂载，保住筛选和选中位置。 */
  reviewOpen: boolean
  reviewActive: boolean
  setReviewOpen: (on: boolean) => void
  /** 从转录区打开的某轮原始编辑记录。 */
  reportedReview: TurnReviewTarget | undefined
  clearReportedReview: () => void
  panelActive: PanelPage
  panelVisible: boolean
  openPanelPage: (page: PanelPage) => void
  togglePanelVisibility: () => void
  /** 宽屏工具组是否暂时独占内容区。 */
  panelFull: boolean
  togglePanelFull: () => void
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
  /** 右侧工作台的可见性与页面；全是“看不看”，不会停任务或改文件。 */
  workbench: WorkbenchState
  openAside: (laneId: string) => void
  openActivity: () => void
  activityIndex: () => void
  openFiles: () => void
  openFile: (target: PreviewTarget) => void
  navigateFile: (direction: -1 | 1) => void
  fileIndex: () => void
  hideWorkbench: () => void
}

export function useShell(): Shell {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const [finding, setFinding] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [railOpen, setRailOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reportedReview, setReportedReview] = useState<TurnReviewTarget>()
  const [panel, setPanel] = useState(CLOSED_PANEL)
  const [focusFilter, setFocusFilter] = useState(0)
  const [askRename, setAskRename] = useState(0)
  const [workbench, setWorkbench] = useState<WorkbenchState>(CLOSED_WORKBENCH)
  const showPanelPage = useCallback((page: PanelPage) => {
    setPanel((before) => openPanel(before, page))
    if (page === "activity") setWorkbench(showActivity)
    if (page === "files") setWorkbench(showFiles)
  }, [])
  const openAside = useCallback((laneId: string) => {
    setPanel((before) => openPanel(before, "activity"))
    setWorkbench((prev) => showLane(prev, laneId))
  }, [])
  const openFile = useCallback((target: PreviewTarget) => {
    setPanel((before) => openPanel(before, "files"))
    setWorkbench((prev) => showFile(prev, { ...target, at: (prev.file?.at ?? 0) + 1 }))
  }, [])
  const closeWorkbench = useCallback(() => {
    setPanel(hidePanel)
  }, [])
  useEffect(() => onFilePreviewRequest(openFile), [openFile])
  useEffect(() => onTurnReviewRequest((target) => {
    setReportedReview((before) => ({ ...target, at: (before?.at ?? 0) + 1 }))
    setPanel((before) => openPanel(before, "review"))
  }), [])
  // 原生通知的超时 effect 依赖它；引用稳定才能避免每次流式重绘都把计时重新开始。
  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => new Set(prev).add(id))
  }, [])
  const workbenchPage = panel.active === "activity" || panel.active === "files"
    ? panel.active
    : workbench.page
  const workbenchVisible = panel.visible && panel.active !== "review"
  const shownWorkbench = workbench.page === workbenchPage && workbench.visible === workbenchVisible
    ? workbench
    : { ...workbench, page: workbenchPage, visible: workbenchVisible }
  return {
    workbench: shownWorkbench,
    openAside,
    openActivity: () => { showPanelPage("activity") },
    activityIndex: () => { setWorkbench(showActivityIndex) },
    openFiles: () => { showPanelPage("files") },
    openFile,
    navigateFile: (direction) => { setWorkbench((before) => navigateFile(before, direction)) },
    fileIndex: () => { setWorkbench(showFileIndex) },
    hideWorkbench: closeWorkbench,
    selectedId,
    select: setSelectedId,
    dismissed,
    dismiss,
    finding,
    setFinding,
    comparing,
    setComparing,
    railOpen,
    toggleRail: () => { setRailOpen((was) => !was) },
    settingsOpen,
    setSettingsOpen,
    reviewOpen: hasPanelTab(panel, "review"),
    reviewActive: panel.visible && panel.active === "review",
    setReviewOpen: (on) => {
      if (on) setReportedReview(undefined)
      setPanel((before) => on ? openPanel(before, "review") : closePanelTab(before, "review"))
    },
    reportedReview,
    clearReportedReview: () => { setReportedReview(undefined) },
    panelActive: panel.active,
    panelVisible: panel.visible,
    openPanelPage: showPanelPage,
    togglePanelVisibility: () => { setPanel(togglePanel) },
    panelFull: panel.full,
    togglePanelFull: () => { setPanel(togglePanelFull) },
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
