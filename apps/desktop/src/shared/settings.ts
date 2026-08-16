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
  /**
   * 置顶的**会话** id，按置顶的先后。
   *
   * 和 `pinned`（置顶项目）并列而不是合成一个：两者虽然都在「置顶」那一段里，
   * 但一个是文件夹、一个是对话，能做的事不一样（项目能展开、会话能改名）。
   * 混成一张表的下场是每次读都要先判断这个字符串到底是路径还是 id。
   */
  pinnedThreads: readonly string[]
  /**
   * 每个项目内会话的**手动顺序**：路径 → 会话 id。
   *
   * 只有被拖过的项目才有这一项。一旦拖过，那个项目就整段按这里排——
   * **不做「一半手动一半自动」**：那种混合排序没人说得清一条新会话该落在哪，
   * 而说不清的排序等于随机。新建的会话排在最前（它最新，也最可能是你要用的）。
   */
  threadOrder: Readonly<Record<string, readonly string[]>>
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
  pinnedThreads: [],
  threadOrder: {},
  defaultEngine: "",
  defaultTrust: "auto-edit",
  projectIcons: {},
}
