import { join } from "node:path"
import { app, BrowserWindow, nativeTheme, shell } from "electron"
import { attachHost, replayHistory, seedDefaultThread } from "./host.js"
import { installMenu } from "./menu.js"
import { installFind } from "./find.js"
import { createLogger } from "./log.js"
import { exportReport } from "./diagnose.js"
import { loadBounds, trackBounds } from "./window-state.js"
import {
  devPrompt,
  scheduleDevFind,
  scheduleDevSwitch,
  scheduleDevInterrupt,
  scheduleDevShot,
} from "./devtools.js"

/**
 * Electron 主进程。
 *
 * 现在只负责开窗。`@omni/host` 接进来之后，引擎子进程会住在这一侧，
 * 渲染层永远不直接 spawn 任何东西——这条边界是故意的：
 * 渲染层崩了不该带走正在跑的引擎。
 */

const isDev = process.env["ELECTRON_RENDERER_URL"] !== undefined

const log = createLogger(join(app.getPath("userData"), "logs"))

/**
 * 全局兜底。**没有这两条，主进程里任何一个漏网的异常都会静默带走整个应用**——
 * 用户看到的是窗口突然消失，日志里什么都没有。
 */
process.on("uncaughtException", (error: Error) => {
  log.write("error", "main", `未捕获异常：${error.stack ?? error.message}`)
})
process.on("unhandledRejection", (reason: unknown) => {
  log.write("error", "main", `未处理拒绝：${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`)
})

function createWindow(bounds: { x: number; y: number; width: number; height: number }): BrowserWindow {
  const win = new BrowserWindow({
    ...bounds,
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
  trackBounds(win)

  // 渲染层的 console 默认只进 DevTools。打包之后没人开 DevTools，
  // 于是「界面崩了」这件事在日志里**一点痕迹都没有**。转发到主进程 stderr，
  // 它才会进用户能拿到的那份日志。
  win.webContents.on("console-message", (event) => {
    if (event.level !== "error" && event.level !== "warning") return
    log.write(event.level === "error" ? "error" : "warn", "renderer", event.message)
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

void app.whenReady().then(async () => {
  log.write("info", "app", `启动 ${app.getVersion()} / ${process.platform} ${process.arch}`)
  installMenu(() => exportReport(log))
  installFind(() => BrowserWindow.getAllWindows())
  const attached = attachHost(() => BrowserWindow.getAllWindows(), log)
  const bounds = await loadBounds()
  const win = createWindow(bounds)
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void loadBounds().then(createWindow)
  })
  // 等窗口挂上监听再开会话，否则最早的几条事件发给了还没订阅的渲染层
  // 先回放历史再开新会话：**顺序不能反**。侧栏最近创建在前，
  // 反过来的话新会话会被压在一堆历史下面。
  win.webContents.once("did-finish-load", () => {
    // 引擎清单先于一切：界面要靠它渲染选择器
    attached.push({ type: "engines.available", at: Date.now(), engines: attached.engines })
    void replayHistory(attached)
      .catch(() => undefined)
      .then((recent) => seedDefaultThread(attached, process.cwd(), devPrompt(), recent))
    scheduleDevFind(win)
    scheduleDevInterrupt(win)
    scheduleDevSwitch(win, (kind, to) => {
      const threadId = attached.lastThreadId()
      if (threadId === undefined) return
      void attached.host
        .dispatch(kind === "fork" ? { type: "thread.fork", threadId, to } : { type: "thread.handoff", threadId, to })
        .catch((error: unknown) => {
          attached.report(error, threadId)
        })
    })
    scheduleDevShot(win)
  })
  app.on("before-quit", () => {
    void attached.host.dispose()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
