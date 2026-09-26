import type { Trust } from "@omni/protocol"
import { NO_PANES, type PaneWidths } from "./pane-widths.js"

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

/**
 * 什么时候出声。
 *
 * **审批单独成一档，不是随便切的三段。** 它是**唯一一个 agent 会停下来等人**的地方：
 * 不出声的话，它十分钟前就停在那儿等你，而你以为它还在干活。跑完与跑挂了则是
 * 「回来看看」级别的——想清静的人该能只留下前者。
 *
 * `off` 关掉的是**系统通知与手机推送**，Dock 角标照挂：那一个不出声、不弹窗，
 * 只是把「有几张卡等着你」写在图标上，而那正是关掉打扰之后唯一还想要的东西。
 */
export type NotifyMode = "all" | "approval" | "off"

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
  /**
   * 桌宠的细项。**`pets: false` 时这里的一切都不生效**——那一档是整块不渲染，
   * 而不渲染的东西没有「显示哪几只」可言。
   */
  petKit: PetKit
  /** 什么时候出声。见 `NotifyMode`。 */
  notify: NotifyMode
  /**
   * **换引擎自动交接**。默认开。
   *
   * 开着时，会话中途换了一家之后发出的第一句话前面，omni 附一段交接说明：
   * 此前谁跑了哪几轮、完整转写落在哪、各家原始记录在哪、那些记录实际是什么格式
   *（见 `@omni/handoff` 的 `briefOf`）。这是 AGENTS.md「不往模型上下文塞 omni 写的话」
   * 唯一的例外，所以它是一个用户看得见、关得掉的开关；关掉就只发用户那句话。
   *
   * 默认开：换引擎几乎总是为了「让新的一家接着干」（额度用光是最常见的原因），
   * 而关着时用户得自己去 `/timeline` 抄路径、再告诉新那家怎么读——那正是它要省掉的两步。
   */
  handoffBrief: boolean
  /**
   * **引擎批量往外发数据时停掉它**。默认开。
   *
   * 外发守卫（`main/egress-guard.ts`）一直在看每个引擎进程往本机外面发了多少；这个开关只管
   * 看见之后停不停。一分钟里它**自己**发了超过 64 MB（不算它跑的命令）就停——正常对话碰不到这条线，
   * 整个仓库连同 .git 往外打包上传过不去。关掉就只报警不停。
   */
  egressStop: boolean
  /**
   * **给 ZCode 的快照目录上锁**。默认开。
   *
   * ZCode 3.14.0 之前的版本会把整个工作区连同 .git 历史打包加密，先落在
   * `~/.zcode/v2/checkpoints/`，再传到阿里云 OSS。给这个目录加上不可改标志，它就写不进新包，
   * 整条链路就断了（见 `main/zcode-guard.ts`）。没装过 ZCode 的机器上什么都不做。
   */
  zcodeLock: boolean
  /**
   * DSH profile 与接入确认。
   *
   * DSH 的 provider、model 与 API 凭证仍归它自己的设置与凭证服务管理；
   * omni 只记「用户确认那边已经配好，可以把 DSH 放进引擎清单」。默认不确认，
   * 因为 ACP 的 initialize 不公开凭证是否就绪，不能拿一次握手冒充可运行。
   */
  dsh: DshSettings
  /**
   * 用户**主动关掉**的引擎 id。
   *
   * ## 为什么和 `dsh.confirmedProfiles` 是两件事
   *
   * 那一条回答「这家的原生配置就绪了吗」——是**它那边**的事实，omni 只是记下用户
   * 替它作的证。这一条回答「我要不要用这家」——是**用户**的选择。装了 grok 但
   * 这台机器上从不用它，和 grok 没配好，在界面上该长得不一样：前者是你关的，
   * 后者是它坏的。压成一个开关，用户关掉一家之后就再也分不出这两种情况。
   *
   * 关掉的那家**连探测都不起**（`engineVisible` 就是拿它过滤的），
   * 所以这也是唯一能让启动少 spawn 几个进程的开关。
   *
   * **omni 不因此改引擎自己的任何行为**：它只是不出现在 omni 的清单里。
   * 你在终端里跑那家，一切照旧。
   */
  disabledEngines: readonly string[]
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
   * **下次开工沿用的那一套**：上次引擎 + 各家各自的模型/思维档。
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
   * 判据是 `Thread.segments` 空不空——空的就是「还没跑过任何一轮」。设置页也允许
   * 直接改某一家的模型/思维档；那只改 `byEngine`，不会冒充一次“上次用了这家”。
   *
   * ## 为什么模型要按引擎分开记
   *
   * 模型 id 是**引擎私有的**：`gpt-5.3-codex-spark` 拿给 Claude 是个不存在的名字。
   * 只记一个全局模型，换家引擎就成了一条起不来的会话。
   */
  lastUsed: LastUsed
  /** 远程访问（浏览器端）。**默认整个关着**。 */
  remote: RemoteSettings
  /**
   * 侧栏和右侧面板被拖成了多宽（见 `pane-widths.ts`）。0 = 没拖过，跟着窗口宽度走。
   * 跟着偏好文件走而不是 localStorage：两台机器、重装之后都还是你拖出来的那个宽度。
   */
  panes: PaneWidths
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

export interface DshSettings {
  /** 新开的 DSH 会话从哪棵插件树启动。 */
  profile: string
  /** 用户确认原生 provider、model 与凭证已配好的 profile；确认按 profile 隔离。 */
  confirmedProfiles: readonly string[]
}

/**
 * 桌宠里那些「怎么显示」的选择。
 *
 * ## 为什么藏起来的记成一张黑名单，而不是记「要显示哪几只」
 *
 * 花名册是**跟着宿主的引擎清单变的**（`pet-roster.ts`）：装一家新的、
 * 在 `engines.json` 里接一家第三方，队伍就多一只。白名单在那一刻会把新来的
 * 判成「没勾过 ＝ 不显示」，于是新接入的引擎在台面上根本不出现——
 * 而用户什么都没关过。黑名单反过来：**没说要藏的一律显示**，
 * 新来的默认在场，这才对得上「默认全显示」这句话。
 */
export interface PetKit {
  /**
   * 主动藏起来的那几只，按花名册的 `key`（真引擎是引擎 id，DSH 那个占位是 `dsh`）。
   *
   * **当前那家永远藏不掉**（过滤在 `petRoster` 里兜住）：藏掉它等于台面上
   * 没有任何地方画着「谁在答」，而那正是这几只存在的唯一理由。
   */
  hidden: readonly string[]
  /**
   * 开应用、换引擎时播不播出场动画。
   *
   * **默认开。** 它是这一层里唯一能说清「换了一家」的东西——比配色更快，
   * 因为一只螃蟹被伞吊下来和一团史莱姆砸在地上，是两件事，不是两个色号。
   * 系统「减少动效」开着时这一项自动失效，不用用户来关。
   */
  entry: boolean
  /**
   * 当前那只要不要**按 token 流速开火**。
   *
   * ## 它到底在画什么
   *
   * 射速恒等于流速：`item.delta` 估出来多快，就打多快（见 `throughput.ts`）。
   * 打在一条纸带上，每中一发落一个字——**子弹不是打给谁的，是打出字来的**。
   * 于是「引擎此刻吐得多快」第一次有了一个不用读数字就能感知的形状。
   *
   * **等级、皮肤、设置里的任何一项都不改射速**。一旦它们能改，
   * 画面上的快慢说的就是你的配置，而不是引擎此刻的表现。
   *
   * 默认开。系统「减少动效」开着时自动失效。
   */
  fire: boolean
  /**
   * 要不要让**压力显形**：上下文快满、这一轮卡住不吐字、流速被压到很低时，
   * 左边会爬过来一些东西，当前那只得把它们打掉。
   *
   * ## 为什么没有「密度」和「种类」这两个旋钮
   *
   * 它们不是关卡内容，是**某个真实信号的化身**：史莱姆 ← 静默、
   * 蜂群 ← 低流速、胖子 ← 上下文逼近上限。密度由那个信号有多严重定。
   * 一旦这两样能调，它们就退回成装饰了——而装饰是不该占着这块地方的。
   *
   * 火力恒等于流速，所以也不需要任何「难度」：引擎吐得快就清得掉，
   * 吐不出来就清不掉。**这不是平衡，这是事实。**
   *
   * 要开火才有得打，所以 `fire` 关着时这一项不生效。
   */
  foes: boolean
  /**
   * 打出去的**弹壳**归谁。
   *
   * ## 为什么这一项可以调，而「密度」「难度」不可以
   *
   * 判据只有一条：**它改不改「打不打得掉」。** 密度一旦能调，敌人就从
   * 压力的化身退回成装饰；而弹壳不参与任何判定——它只是同一件事的
   * 另一种读法，所以三档都诚实：
   *
   * - `off` 不抛。画面最干净，代价是「刚打过一发」只剩枪口那一下。
   * - `eject` 抛出去。一发一枚往斜后上方甩，落地弹两下就没了——
   *   **它读的是节奏**：连发时壳会连成一串。
   * - `pile` 堆着。壳不消失，落地就停，**堆多高就是这一轮吐了多少**
   *   （也就是「在途」——吐出来了、还没结账的那一批），结账那一下整堆扫平。
   *   这是这套东西里唯一一处把「在途」画出来的地方，而在途正是
   *   `Usage` 那道阶梯中间空掉的那一段。
   *
   * `fire` 关着时这一项不生效——不开火就没有壳。
   */
  brass: BrassMode
  /**
   * 弹丸打到哪儿去。
   *
   * - `tape` **打字机**：打在左边那条纸带上，每中一发落一个字。
   *   这一档说的是**产出**——子弹不是打给谁的，是打出字来的。
   * - `shell` **抛壳**：没有纸带；**每一发本身就是一枚壳**，往斜后上方抛出去、
   *   走一条看得清的弧、落地弹两下。这一档说的是**后坐力**——
   *   这一下有多大劲、下一下隔多久来。
   *
   * ## 有东西爬过来时两档一样，都朝它直射
   *
   * 这条不是例外，是底线：火力恒等于流速，而「打不打得掉」必须只由流速决定。
   * 让弹道决定打不打得着的话，选了抛壳的人就永远清不掉那些东西——
   * 那时候画面上的胜负说的是你的设置，不是引擎此刻的表现。
   */
  traj: TrajMode
  /**
   * 打靶：台面上立一张靶，子弹改打它，弹着留洞不消失。
   *
   * ## 它和其余每一项都不是一类东西，所以界面上必须说清楚
   *
   * 这套东西里每一样都编码着一个真实的引擎信号，而**打靶编码不了任何东西**
   * ——引擎不会没事去打靶。它是个**评估台**：把节奏、后坐、上下文三样
   * 摆到一个能量的地方看。
   *
   * - 节奏 → 弹着在时间上的疏密；
   * - 后坐 → 弹着在空间上的**上飘**（连发时枪口一路上抬，洞就一路往上串，
   *   这是那条 kick 曲线唯一能被直接看见的地方）；
   * - 上下文 → **有效区**。靶上被上下文吃掉的那一圈不算命中，
   *   因为上下文变满本来就是真实的能力衰减。
   *
   * 默认关。开着时纸带那一路让位——同一把枪不能同时打两个地方。
   */
  range: boolean
}

/** 见 `PetKit.brass`。 */
export type BrassMode = "off" | "eject" | "pile"

/** 见 `PetKit.traj`。 */
export type TrajMode = "tape" | "shell"

/** 与 DSH launcher 的公开 profile 名校验保持同形；驱动启动前还会再守一次。 */
export function isDshProfileName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && name !== "node_modules"
    && !name.includes("/") && !name.includes("\\")
}

export function dshProfileConfirmed(dsh: DshSettings): boolean {
  return dsh.confirmedProfiles.includes(dsh.profile)
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
  petKit: {
    hidden: [],
    entry: true,
    fire: true,
    foes: true,
    brass: "eject",
    traj: "tape",
    range: false,
  },
  notify: "all",
  handoffBrief: true,
  egressStop: true,
  zcodeLock: true,
  dsh: { profile: "acp", confirmedProfiles: [] },
  disabledEngines: [],
  defaultEngine: "",
  defaultTrust: "auto-edit",
  projectIcons: {},
  lastUsed: { engine: "", byEngine: {} },
  remote: { enabled: false, port: 17800, trustedHosts: [], maxTrust: "auto-edit" },
  panes: NO_PANES,
}
