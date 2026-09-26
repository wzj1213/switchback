import { lazy } from "react"

// 设置外壳和导航即时出现；只加载用户选中的页面及其依赖。
export const DataSection = lazy(() => import("./SettingsData.js").then((m) => ({ default: m.DataSection })))
export const GuardSection = lazy(() => import("./SettingsGuard.js").then((m) => ({ default: m.GuardSection })))
export const EnginesSection = lazy(() => import("./EngineSettings.js").then((m) => ({ default: m.EnginesSection })))
export const EnvSection = lazy(() => import("./SettingsEnv.js").then((m) => ({ default: m.EnvSection })))
export const ActivitySection = lazy(() => import("./SettingsActivity.js").then((m) => ({ default: m.ActivitySection })))
export const RemotePanel = lazy(() => import("./RemotePanel.js").then((m) => ({ default: m.RemotePanel })))
export const PetsSection = lazy(() => import("./SettingsPets.js").then((m) => ({ default: m.PetsSection })))
export const EngineShared = lazy(() => import("./EngineShared.js").then((m) => ({ default: m.EngineShared })))
