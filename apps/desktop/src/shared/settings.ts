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
  /**
   * 打开过的项目，按打开的先后。
   *
   * ## 为什么项目要单独记一份
   *
   * 侧栏的项目本来是**从会话推出来的**（`groupByWorkspace`），于是「打开一个文件夹」
   * 必须顺手建一条会话，否则那个项目在界面上根本不存在。而那是本末倒置：
   * **一个项目不必有会话**——你可能只是想先把它放进侧栏，明天再开工。
   * 顺带还修掉一个隐性后果：把一个项目里的会话全删掉，那个项目就整个消失了。
   */
  projects: readonly string[]
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
  /**
   * 项目在侧栏里的手动顺序（路径数组）。空 = 还没拖过，按活跃度排。
   *
   * 和 `threadOrder` 是同一条规矩的两个尺度：**拖过一次，整段就归你排**。
   */
  projectOrder: readonly string[]
  /**
   * 输入框上沿那几只要不要出现。
   *
   * **默认开。** 它不是功能而是性格，而性格该是默认的那一面；
   * 真嫌它碍事的人会自己去关，而一个默认关着的彩蛋等于没做。
   *
   * 关掉是整块不渲染（连那层活动区都不挂），不是把它藏起来——
   * 藏起来的话它照样占着指针事件的那一层。
   */
  pets: boolean
  /** 新会话默认用哪家引擎。空 = 按 `lastUsed` 走（见那边）。 */
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
  /**
   * **上次开工时用的那一套**：引擎 + 各家各自的模型/思维档。
   *
   * ## 记的时刻是「发出第一句话」，不是「点了选择器」
   *
   * 新开一条会话、挑好引擎和模型、**把话发出去**——这一下才算数。
   * 光点开下拉看看不算：那可能只是在翻有哪些模型。
   *
   * ## 之后同一条会话里怎么改都不再刷新
   *
   * 一条会话跑到一半换个模型，是**针对这段活**的临时决定
   *（「这段太绕了，换个强的想想」），不是「我以后都这么开」。
   * 把它记成偏好的话，你为了一个难题临时开的 high，会跟着你到之后每一条新会话。
   *
   * 判据是 `Thread.segments` 空不空——空的就是「还没跑过任何一轮」。
   *
   * ## 为什么模型要按引擎分开记
   *
   * 模型 id 是**引擎私有的**：`gpt-5.3-codex-spark` 拿给 Claude 是个不存在的名字。
   * 只记一个全局模型，换家引擎就成了一条起不来的会话。
   */
  lastUsed: LastUsed
  /** 远程访问（浏览器端）。**默认整个关着**。 */
  remote: RemoteSettings
}

/**
 * 远程访问。
 *
 * ## 为什么没有「绑哪个地址」这一项
 *
 * 服务端**永远只 listen 127.0.0.1**，没有开关。一个能改成 `0.0.0.0` 的选项，
 * 迟早会有人在一台公网机器上打开它——而这台机器上跑着一个有写和执行权限的 agent。
 * 要从外面访问就开隧道（`ssh -R`），那条路是显式的、可撤销的、留痕的。
 */
export interface RemoteSettings {
  enabled: boolean
  /** 回环上的端口。0 = 由系统挑一个。 */
  port: number
  /**
   * 隧道那头对外的 authority（`omni.example.com:8443`），可以写多条。
   *
   * 不填就只认回环——那时只有 `ssh -L` 那种把端口映到本机的用法能通。
   * 填的必须是**裸 host[:port]**：写成带路径或带 scheme 的形式会在启动时大声报错，
   * 因为解析会悄悄改变它授权的范围（见 `remote/fence.ts`）。
   */
  trustedHosts: readonly string[]
  /**
   * 远程连接的**信任档上限**。手机丢了不该等于在你的仓库里任意执行代码。
   *
   * 默认 `auto-edit`：远程能改文件，但每条 shell 命令仍然要弹审批——
   * 也就是**你在手机上看得见每一条要跑的命令**。
   */
  maxTrust: Trust
}

export interface LastUsed {
  /** 上次开工用的引擎。空 = 还没记过。 */
  engine: string
  /** 引擎 id → 那家上次用的模型/思维档。 */
  byEngine: Readonly<Record<string, EnginePick>>
}

export interface EnginePick {
  model?: string
  effort?: string
}

export const SETTINGS_DEFAULTS: Settings = {
  theme: "system",
  projects: [],
  pinned: [],
  pinnedThreads: [],
  projectOrder: [],
  threadOrder: {},
  pets: true,
  defaultEngine: "",
  defaultTrust: "auto-edit",
  projectIcons: {},
  lastUsed: { engine: "", byEngine: {} },
  remote: { enabled: false, port: 17800, trustedHosts: [], maxTrust: "auto-edit" },
}
