/**
 * 侧栏与右侧面板的宽度：用户拖出来的那个数，以及它能拖到哪儿。
 *
 * 纯逻辑，主进程（校验设置文件）和渲染层（拖动时限位）共用同一份边界——
 * 两边各写一套的话，设置文件里就会出现一个界面拖不到、却被原样吃进去的宽度。
 *
 * `0` 表示「没拖过」：宽度跟着默认规则走（侧栏 240 / 窄窗 224，面板取工作区四成）。
 * 用 0 而不是 `undefined`：设置文件是 JSON，一个一直在的数比一个时有时无的键好校验。
 */
export interface PaneWidths {
  sidebar: number
  panel: number
}

export const NO_PANES: PaneWidths = { sidebar: 0, panel: 0 }

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 420
export const PANEL_MIN = 280
export const PANEL_MAX = 960
/**
 * 中间那一列（对话）至少留这么宽：输入区那排控件在 420 以下会折成三行，
 * 正文也读不成句了。拖侧栏、拖面板都不能把它挤到这以下。
 */
export const MAIN_MIN = 420

function within(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), max))
}

/** 侧栏能拖到多宽：自身上下限，且给对话留出 `MAIN_MIN`。 */
export function clampSidebar(width: number, viewport: number): number {
  const room = Math.max(SIDEBAR_MIN, viewport - MAIN_MIN)
  return within(width, SIDEBAR_MIN, Math.min(SIDEBAR_MAX, room))
}

/** 面板能拖到多宽：自身上下限，且扣掉侧栏之后仍给对话留出 `MAIN_MIN`。 */
export function clampPanel(width: number, viewport: number, rail: number): number {
  const room = Math.max(PANEL_MIN, viewport - rail - MAIN_MIN)
  return within(width, PANEL_MIN, Math.min(PANEL_MAX, room))
}

/** 设置文件里读出来的值。认不出、越界的一律当「没拖过」，不替用户猜一个宽度。 */
export function paneWidths(raw: unknown): PaneWidths {
  if (typeof raw !== "object" || raw === null) return NO_PANES
  const it = raw as Partial<Record<keyof PaneWidths, unknown>>
  return {
    sidebar: inRange(it.sidebar, SIDEBAR_MIN, SIDEBAR_MAX),
    panel: inRange(it.panel, PANEL_MIN, PANEL_MAX),
  }
}

function inRange(raw: unknown, min: number, max: number): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= min && raw <= max ? Math.round(raw) : 0
}
