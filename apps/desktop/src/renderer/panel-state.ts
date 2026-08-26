export type PanelPage = "review" | "activity" | "files"

export interface PanelState {
  tabs: readonly PanelPage[]
  active: PanelPage
  visible: boolean
  full: boolean
}

export const CLOSED_PANEL: PanelState = {
  tabs: [],
  active: "review",
  visible: false,
  full: false,
}

export function openPanel(state: PanelState, page: PanelPage): PanelState {
  const tabs = state.tabs.includes(page) ? state.tabs : [...state.tabs, page]
  return { ...state, tabs, active: page, visible: true }
}

export function hidePanel(state: PanelState): PanelState {
  return state.visible || state.full ? { ...state, visible: false, full: false } : state
}

export function togglePanel(state: PanelState): PanelState {
  if (state.visible) return hidePanel(state)
  return openPanel(state, state.tabs.includes(state.active) ? state.active : "review")
}

export function closePanelTab(state: PanelState, page: PanelPage): PanelState {
  const index = state.tabs.indexOf(page)
  if (index < 0) return state
  const tabs = state.tabs.filter((tab) => tab !== page)
  if (tabs.length === 0) return CLOSED_PANEL
  if (state.active !== page) return { ...state, tabs }
  return { ...state, tabs, active: tabs[Math.min(index, tabs.length - 1)] ?? "review" }
}

export function togglePanelFull(state: PanelState): PanelState {
  return state.visible ? { ...state, full: !state.full } : state
}

export function hasPanelTab(state: PanelState, page: PanelPage): boolean {
  return state.tabs.includes(page)
}
