import { BrowserWindow, Menu, app, type BaseWindow, type MenuItemConstructorOptions } from "electron"
import { quitNow } from "./quit.js"

/**
 * 菜单里那些**只有渲染层做得到**的动作。
 *
 * 新建会话、打开文件夹这些要落到当前选中的会话上下文里，主进程不知道那是什么。
 * 所以菜单只发一个意图，怎么做由渲染层决定。
 */
export type MenuAction =
  | "new-thread"
  | "open-folder"
  | "interrupt"
  | "find"
  | "copy-markdown"
  | "pickup"
  | "compare"
  | "review"
  | "filter-threads"
  | "settings"
  | "toggle-rail"
  | "toggle-panel"

const isMac = process.platform === "darwin"

/** 菜单回调给的是 `BaseWindow`；只有 `BrowserWindow` 才有 webContents。 */
function send(action: MenuAction, focused: BaseWindow | undefined): void {
  if (!(focused instanceof BrowserWindow) || focused.isDestroyed()) return
  focused.webContents.send("omni:menu", action)
}

/**
 * 应用菜单。
 *
 * Electron 不设菜单时会给一份默认模板——能用，但里面没有任何 omni 自己的动作，
 * 于是**新建会话只能靠鼠标点侧栏**，一个每天用几十次的操作没有快捷键。
 *
 * 编辑/窗口/显示这几栏一律用 `role`：系统会自己本地化、自己接上原生行为
 * （撤销栈、拼写检查、缩放）。手写这些只会做得更差。
 */
/** 文件：新建会话与打开文件夹——每天用几十次，必须有快捷键。 */
function fileMenu(onEngines: () => void): MenuItemConstructorOptions {
  return {
    label: "文件",
    submenu: [
      {
        label: "新建会话",
        accelerator: "CmdOrCtrl+N",
        click: (_i, focused) => {
          send("new-thread", focused)
        },
      },
      {
        // ⌘, 是 macOS 上「打开设置」的通用键位，用户不用学
        label: "设置",
        accelerator: "CmdOrCtrl+,",
        click: (_i, focused) => {
          send("settings", focused)
        },
      },
      { type: "separator" },
      {
        label: "筛选会话",
        accelerator: "CmdOrCtrl+K",
        click: (_i, focused) => {
          send("filter-threads", focused)
        },
      },
      {
        label: "打开文件夹…",
        accelerator: "CmdOrCtrl+O",
        click: (_i, focused) => {
          send("open-folder", focused)
        },
      },
      { type: "separator" },
      {
        // 注册第三方 ACP 引擎。放「文件」里而不是藏在帮助菜单：
        // 它编辑的是一个真实文件，动作也确实是「打开一个文件」
        label: "引擎注册表…",
        click: onEngines,
      },
      { type: "separator" },
      { role: isMac ? "close" : "quit" },
    ],
  }
}

/** 会话：作用在当前这一个会话上的动作。 */
function threadMenu(): MenuItemConstructorOptions {
  return {
    label: "会话",
    submenu: [
      {
        label: "在会话中查找",
        accelerator: "CmdOrCtrl+F",
        click: (_i, focused) => {
          send("find", focused)
        },
      },
      {
        label: "复制会话为 Markdown",
        accelerator: "Shift+CmdOrCtrl+C",
        click: (_i, focused) => {
          send("copy-markdown", focused)
        },
      },
      {
        // 没有分叉对手时点它不会有反应——菜单项做不到按会话状态动态启用/禁用
        // （主进程不知道当前选中的是谁），这是这条通道的固有限制
        label: "对比分叉",
        accelerator: "Shift+CmdOrCtrl+D",
        click: (_i, focused) => {
          send("compare", focused)
        },
      },
      {
        // 和「对比分叉」一样：主进程不知道当前选中的是谁，所以菜单项没法按状态禁用。
        // 不是仓库时点它会开出一块面板，上面照实说「这个工作区不是 git 仓库」
        label: "审核改动",
        accelerator: "Shift+CmdOrCtrl+R",
        click: (_i, focused) => {
          send("review", focused)
        },
      },
      {
        /*
         * 换引擎最常连着做的第二件事：把上一家那份原始记录的路径填进输入框。
         *
         * **它只填路径，不发送、也不替你写那句话**（见 `renderer/pickup.ts`）。
         * 和「对比分叉」一样，主进程不知道当前选中的是谁，所以这一项没法按
         * 状态禁用——没有可承接的那一段时按它不会有任何反应。
         */
        label: "承接上一段引擎记录",
        accelerator: "Shift+CmdOrCtrl+E",
        click: (_i, focused) => {
          send("pickup", focused)
        },
      },
      {
        label: "中断当前轮次",
        accelerator: "CmdOrCtrl+.",
        click: (_i, focused) => {
          send("interrupt", focused)
        },
      },
    ],
  }
}

/**
 * 显示。
 *
 * **这一栏原来是 `{ role: "viewMenu" }`**，而文件头那句「编辑/显示/窗口三栏
 * 一律用 role」的理由是「系统会自己本地化、自己接上原生行为」。那条理由
 * 是**逐项**成立的，所以下面每一项仍然是 role——手写的只有栏目标签本身，
 * 而文件、会话、帮助三栏本来就是手写的中文标签。
 *
 * 换掉它只为加一件 role 给不了的事：**收起侧栏**。侧栏固定 264px，
 * 在最小窗口（860px）下吃掉三成宽度，而此前全仓没有任何入口能收起它——
 * claude 与 codex 的左上角第一颗按钮都是这个开关，`⌘\` 也是这三家
 * （连同 VS Code）一致的组合键。
 */
function viewMenu(): MenuItemConstructorOptions {
  return {
    label: "显示",
    submenu: [
      {
        label: "收起 / 展开侧栏",
        accelerator: "CmdOrCtrl+\\",
        click: (_i, focused) => {
          send("toggle-rail", focused)
        },
      },
      {
        // 右上角那颗开关的「一定可以点」版本：拖拽区出问题时菜单和快捷键永远在
        label: "收起 / 展开侧边面板",
        accelerator: "Alt+CmdOrCtrl+B",
        click: (_i, focused) => {
          send("toggle-panel", focused)
        },
      },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
      { type: "separator" },
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
    ],
  }
}

/**
 * 帮助：打包之后没有终端，出问题时用户手上什么都没有。
 * 这一项就是「把能说明情况的东西凑成一份」。
 */
function helpMenu(
  onDiagnose: () => Promise<void>,
  onCheckUpdate: (() => Promise<void>) | undefined,
): MenuItemConstructorOptions {
  return {
    role: "help",
    submenu: [
      // 没配更新源时**这一项根本不出现**，而不是灰着。
      // 一个永远灰着的菜单项只会让人反复去点它找原因
      ...(onCheckUpdate === undefined
        ? []
        : [
            {
              label: "检查更新…",
              click: (): void => {
                void onCheckUpdate()
              },
            } as MenuItemConstructorOptions,
            { type: "separator" } as MenuItemConstructorOptions,
          ]),
      {
        label: "导出诊断报告…",
        click: () => {
          void onDiagnose()
        },
      },
    ],
  }
}

/**
 * 应用菜单。
 *
 * Electron 不设菜单时会给一份默认模板——能用，但里面**没有任何 omni 自己的动作**，
 * 于是「新建会话」这个每天用几十次的操作只能靠鼠标点侧栏。
 *
 * 编辑/显示/窗口三栏一律用 `role`：系统会自己本地化、自己接上原生行为
 * （撤销栈、拼写检查、缩放）。手写这些只会做得更差。
 */
export function installMenu(
  onDiagnose: () => Promise<void>,
  onEngines: () => void,
  onCheckUpdate?: () => Promise<void>,
): void {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    fileMenu(onEngines),
    { role: "editMenu" },
    threadMenu(),
    viewMenu(),
    { role: "windowMenu" },
    helpMenu(onDiagnose, onCheckUpdate),
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  // 非 mac 上没有 appMenu 角色，退出项挂在「文件」里，这里不再重复
  // 不问确认，理由和 `index.ts` 里那条同名处理器一样：这时已经没有窗口可以取消回去了
  if (!isMac) app.on("window-all-closed", () => { quitNow() })
}
