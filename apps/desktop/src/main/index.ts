import { join } from "node:path"
import { app, BrowserWindow, nativeTheme, shell } from "electron"
import { attachHost, replayHistory, seedDefaultThread } from "./host.js"
import { devPrompt, scheduleDevShot } from "./devtools.js"

/**
 * Electron 主进程。
 *
 * 现在只负责开窗。`@omni/host` 接进来之后，引擎子进程会住在这一侧，
 * 渲染层永远不直接 spawn 任何东西——这条边界是故意的：
 * 渲染层崩了不该带走正在跑的引擎。
 */

const isDev = process.env["ELECTRON_RENDERER_URL"] !== undefined

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 560,
    show: false,
    titleBarStyle: "hiddenInset",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111113" : "#ffffff",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once("ready-to-show", () => {
    win.show()
  })

  // 渲染层的 console 默认只进 DevTools。打包之后没人开 DevTools，
  // 于是「界面崩了」这件事在日志里**一点痕迹都没有**。转发到主进程 stderr，
  // 它才会进用户能拿到的那份日志。
  win.webContents.on("console-message", (event) => {
    if (event.level !== "error" && event.level !== "warning") return
    process.stderr.write(`[renderer:${event.level}] ${event.message}\n`)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: "deny" }
  })

  // 渲染的是模型产出的 Markdown，里面可能有链接。带 target 的走上面的
  // handler 去外部浏览器；没有 target 的会**就地导航**，把整个应用页面顶掉。
  // 这里兜底：一律拦下并转给系统浏览器。
  win.webContents.on("will-navigate", (event, url) => {
    if (url === win.webContents.getURL()) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  const devUrl = process.env["ELECTRON_RENDERER_URL"]
  if (isDev && devUrl !== undefined) void win.loadURL(devUrl)
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"))

  return win
}

void app.whenReady().then(() => {
  const attached = attachHost(() => BrowserWindow.getAllWindows())
  const win = createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  // 等窗口挂上监听再开会话，否则最早的几条事件发给了还没订阅的渲染层
  // 先回放历史再开新会话：**顺序不能反**。侧栏最近创建在前，
  // 反过来的话新会话会被压在一堆历史下面。
  win.webContents.once("did-finish-load", () => {
    void replayHistory(attached)
      .catch(() => undefined)
      .then((recent) => seedDefaultThread(attached, process.cwd(), devPrompt(), recent))
    scheduleDevShot(win)
  })
  app.on("before-quit", () => {
    void attached.host.dispose()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
