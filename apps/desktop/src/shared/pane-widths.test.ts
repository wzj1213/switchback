import { describe, expect, it } from "vitest"
import {
  MAIN_MIN, PANEL_MAX, PANEL_MIN, SIDEBAR_MAX, SIDEBAR_MIN, clampPanel, clampSidebar, paneWidths,
} from "./pane-widths.js"

describe("侧栏拖到多宽", () => {
  const cases = [
    ["默认窗口里照拖", 300, 1280, 300],
    ["不低于下限", 120, 1280, SIDEBAR_MIN],
    ["不高于上限", 900, 1920, SIDEBAR_MAX],
    ["窄窗给对话留位", 420, 800, 800 - MAIN_MIN],
    ["窗口小到留不出也守住下限", 300, 500, SIDEBAR_MIN],
    ["小数取整", 250.6, 1280, 251],
  ] as const
  for (const [name, width, viewport, expected] of cases) {
    it(name, () => { expect(clampSidebar(width, viewport)).toBe(expected) })
  }
})

describe("面板拖到多宽", () => {
  const cases = [
    ["默认窗口里照拖", 500, 1280, 240, 500],
    ["不低于下限", 100, 1280, 240, PANEL_MIN],
    ["宽屏也有上限", 1400, 2560, 240, PANEL_MAX],
    ["扣掉侧栏后给对话留位", 700, 1280, 240, 1280 - 240 - MAIN_MIN],
    ["收起侧栏时能更宽", 700, 1280, 0, 700],
    ["窗口小到留不出也守住下限", 500, 860, 240, PANEL_MIN],
  ] as const
  for (const [name, width, viewport, rail, expected] of cases) {
    it(name, () => { expect(clampPanel(width, viewport, rail)).toBe(expected) })
  }
})

describe("设置文件里的宽度", () => {
  const cases = [
    ["没有这一项", undefined, { sidebar: 0, panel: 0 }],
    ["正常值原样", { sidebar: 260, panel: 480 }, { sidebar: 260, panel: 480 }],
    ["越界当没拖过", { sidebar: 90, panel: 5000 }, { sidebar: 0, panel: 0 }],
    ["不是数当没拖过", { sidebar: "260", panel: null }, { sidebar: 0, panel: 0 }],
    ["非有限数当没拖过", { sidebar: Number.NaN, panel: Number.POSITIVE_INFINITY }, { sidebar: 0, panel: 0 }],
    ["0 就是没拖过", { sidebar: 0, panel: 0 }, { sidebar: 0, panel: 0 }],
    ["小数取整", { sidebar: 260.4, panel: 480.6 }, { sidebar: 260, panel: 481 }],
  ] as const
  for (const [name, raw, expected] of cases) {
    it(name, () => { expect(paneWidths(raw)).toEqual(expected) })
  }
})
