import { BrowserWindow, Menu, app, type BaseWindow, type MenuItemConstructorOptions } from "electron"

/**
 * 菜单里那些**只有渲染层做得到**的动作。
 *
 * 新建会话、打开文件夹这些要落到当前选中的会话上下文里，主进程不知道那是什么。
 * 所以菜单只发一个意图，怎么做由渲染层决定。
 */
export type MenuAction = "new-thread" | "open-folder" | "interrupt" | "find" | "copy-markdown"

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
function fileMenu(): MenuItemConstructorOptions {
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
        label: "打开文件夹…",
        accelerator: "CmdOrCtrl+O",
        click: (_i, focused) => {
          send("open-folder", focused)
        },
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
 * 帮助：打包之后没有终端，出问题时用户手上什么都没有。
 * 这一项就是「把能说明情况的东西凑成一份」。
 */
function helpMenu(onDiagnose: () => Promise<void>): MenuItemConstructorOptions {
  return {
    role: "help",
    submenu: [
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
export function installMenu(onDiagnose: () => Promise<void>): void {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    fileMenu(),
    { role: "editMenu" },
    threadMenu(),
    { role: "viewMenu" },
    { role: "windowMenu" },
    helpMenu(onDiagnose),
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  // 非 mac 上没有 appMenu 角色，退出项挂在「文件」里，这里不再重复
  if (!isMac) app.on("window-all-closed", () => app.quit())
}
