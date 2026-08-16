import type { Trust } from "@omni/protocol"

/**
 * 用户偏好。**主进程、preload、渲染层共用这一份定义。**
 *
 * 原来是两份手抄的（`main/settings.ts` 一份、`renderer/useSettings.ts` 一份），
 * 今天恰好一致——而「恰好一致」不是保证。preload 那层更糟：
 * 它的签名写的是 `Record<string, unknown>`，于是渲染层拿到的东西
 * **在类型上根本不是 Settings**，只是没人发现（那份 `window.omni` 的声明
 * 是手写的，和实现各说各话）。
 *
 * 放 `shared/` 而不是 `@omni/protocol`：这是**桌面应用自己的偏好**，
 * 和「渲染层与宿主之间的协议」是两回事。protocol 那层要保持只描述会话与事件。
 */
export type ThemeChoice = "system" | "light" | "dark"

export interface Settings {
  theme: ThemeChoice
  /** 置顶的工作区路径，按用户置顶的先后。 */
  pinned: readonly string[]
  /** 新会话默认用哪家引擎。空 = 沿用当前会话的。 */
  defaultEngine: string
  /** 新会话默认的信任档。 */
  defaultTrust: Trust
  /**
   * 项目自己的图标：工作区路径 → 一个 emoji。
   *
   * ## 为什么是 emoji 不是图片文件
   *
   * 图片要管理：存哪儿、多大、删项目时谁清理、换机器怎么跟着走。
   * 而这件事要解决的问题只是「一列长得一样的文件夹图标里，
   * **一眼认出哪个是哪个**」——一个 emoji 就够了，它还天生跨平台、
   * 跟着偏好文件走、不占磁盘。
   *
   * 存路径不存项目名：同名目录太常见，而路径是这里唯一稳定的身份。
   */
  projectIcons: Readonly<Record<string, string>>
}

export const SETTINGS_DEFAULTS: Settings = {
  theme: "system",
  pinned: [],
  defaultEngine: "",
  defaultTrust: "auto-edit",
  projectIcons: {},
}
