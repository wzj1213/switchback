import { join } from "node:path"
import { readFileSync } from "node:fs"
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron"
import { homedir } from "node:os"
import { fixPath } from "./loginpath.js"
import { attachHost, rebuild, seedDefaultThread, type Attached } from "./host.js"
import { installMenu } from "./menu.js"
import { installFind } from "./find.js"
import { createLogger, type Logger } from "./log.js"
import { exportReport } from "./diagnose.js"
import { ensureEngineFile } from "./engines.js"
import { clearMarker, installCrashReporter, watchProcesses } from "./crash.js"
import { announce, checkForUpdate, feedOf, fetchText } from "./update.js"
import { createSettings, installSettingsChannel } from "./settings.js"
import { installWorksiteChannel } from "./worksite.js"
import { loadBounds, trackBounds } from "./window-state.js"
import { applyDevTheme, defaultWorksite, devPrompt, scheduleDevCompare, scheduleDevFilter, scheduleDevFind, scheduleDevInterrupt, scheduleDevOpenSelect, scheduleDevProbe, scheduleDevReload, scheduleDevRowMenu, scheduleDevShot, scheduleDevSwitch } from "./devtools.js"

/**
 * Electron 主进程。
 *
 * 现在只负责开窗。`@omni/host` 接进来之后，引擎子进程会住在这一侧，
 * 渲染层永远不直接 spawn 任何东西——这条边界是故意的：
 * 渲染层崩了不该带走正在跑的引擎。
 */

const isDev = process.env["ELECTRON_RENDERER_URL"] !== undefined

const log = createLogger(join(app.getPath("userData"), "logs"))

// **必须在 whenReady 之前**：崩溃处理器要赶在渲染进程被创建之前装上，
// 否则那些进程崩了不会留下任何转储
const crash = installCrashReporter(log)

/**
 * 偏好。**在开窗之前建**：主题要在第一帧之前定下来，
 * 否则窗口会先按系统色画一下再跳成用户选的那套。
 */
const settings = createSettings(log)

/**
 * 更新检查。**没配 feed 就整个不存在**——不发请求、不起定时器、菜单里也不出现。
 * 只查不装的理由见 `update.ts`：没签名的应用装不了更新。
 */
const feed = feedOf(
  // 打包之后 package.json 在 asar 里，`app.getAppPath()` 指得到它
  (() => {
    try {
      return JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8")) as {
        omni?: { updateFeed?: unknown }
      }
    } catch {
      return undefined
    }
  })(),
)

const runUpdateCheck = async (manual: boolean): Promise<void> => {
  const result = await checkForUpdate({ feed, current: app.getVersion(), fetchText })
  await announce(
    result,
    {
      ask: async (options) => (await dialog.showMessageBox({ type: "info", ...options })).response,
      open: (url) => {
        void shell.openExternal(url)
      },
      log: (level, message) => {
        log.write(level, "update", message)
      },
    },
    manual,
  )
}

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

/**
 * 设置面板要用的三条通道。
 *
 * 走的是**和菜单同一条路**（`openEngines` / `exportReport`），不复制实现——
 * 摆两份实现的下场是其中一份迟早不更新，而那份正好是用户用的那份。
 */
function installAppChannels(): void {
  ipcMain.handle("omni:appInfo", () => ({
    version: app.getVersion(),
    dataDir: app.getPath("userData"),
  }))
  ipcMain.on("omni:openEngines", () => {
    void shell.openPath(ensureEngineFile(app.getPath("userData")))
  })
  ipcMain.on("omni:diagnose", () => {
    void exportReport(log, crash)
  })
}

/** 开发钩子。全挂在这里，`whenReady` 那段只管应用本身怎么起。 */
function installDevHooks(win: BrowserWindow, attached: Attached, logger: Logger): void {
  scheduleDevFind(win)
  scheduleDevInterrupt(win)
  scheduleDevReload(win)
  scheduleDevCompare(win)
  scheduleDevFilter(win)
  scheduleDevOpenSelect(win)
  scheduleDevRowMenu(win)
  scheduleDevProbe(win, (m: string) => {
    logger.write("info", "dev", m)
  })
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
}

/**
 * 只允许开一个 omni。
 *
 * ## 为什么这不是「体验优化」，是数据完整性
 *
 * 两个实例共用同一个 `userData`：**同一份 journal、同一份日志、同一个
 * Crashpad 数据库**。于是——
 *
 * - 两个宿主各自往同一批 jsonl 里 append，谁也不知道对方写了什么；
 * - 两边各自「开机自动建默认会话」，磁盘上凭空多出一个没人开过的会话
 *   （2026-08-14 我遇到过一次凭空多出来的分叉，查不出原因，八成就是这个）；
 * - 两个 crashpad handler 抢同一个数据库，实测直接 `FATAL: mach_port_request_notification`。
 *
 * 这些全都**不报错**，只是数据慢慢变得对不上。
 *
 * ## 第二个实例做什么
 *
 * 不是静默退出——那样双击图标像是「点了没反应」。把已经开着的那扇窗
 * 举到前面来，这正是用户点第二下想要的东西。
 */
function claimSingleInstance(): boolean {
  if (app.requestSingleInstanceLock()) return true
  app.quit()
  return false
}

if (!claimSingleInstance()) {
  // `app.quit()` 是异步的，这里必须挡住后面的启动流程，
  // 否则这个注定要退出的实例还是会先建窗口、先碰一遍 journal
  log.write("info", "app", "已经有一个 omni 在跑了，把那扇窗举到前面，这个实例退出")
} else {
  void bootstrap()
}

function bootstrap(): Promise<void> {
  return app.whenReady().then(async () => {
    // **第一件事**：把 PATH 补成登录 shell 那一份。探测引擎、spawn 引擎都要用，
    // 而从 Dock 启动时它默认只有 `/usr/bin:/bin:/usr/sbin:/sbin`
    await fixPath(log)
    installSettingsChannel(settings)
    installAppChannels()
    installWorksiteChannel()
    applyDevTheme()
    log.write("info", "app", `启动 ${app.getVersion()} / ${process.platform} ${process.arch}`)
    installMenu(
      () => exportReport(log, crash),
      () => {
        // 用系统默认编辑器打开，不自己造一个配置界面：这是一份十行的 JSON，
        // 用户自己的编辑器有语法高亮和括号匹配，我们做不过它
        void shell.openPath(ensureEngineFile(app.getPath("userData")))
      },
      feed === "" ? undefined : () => runUpdateCheck(true),
    )
    // 背景检查只在配了 feed 时跑，而且**只在有新版本时才出声**
    if (feed !== "") setTimeout(() => void runUpdateCheck(false), 10_000)
    installFind(() => BrowserWindow.getAllWindows())
    watchProcesses(log, () => BrowserWindow.getAllWindows())
    const attached = attachHost(() => BrowserWindow.getAllWindows(), log)
    const bounds = await loadBounds()
    const win = createWindow(bounds)
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void loadBounds().then(createWindow)
    })
    // **每次加载都重建**，不只是第一次。渲染层重载（开发期热更、崩溃恢复、
    // 用户按了 ⌘R）之后状态是空的，只补增量补不出前面的历史。
    // **重建和开会话必须串起来，不能各跑各的。** 两条独立的异步链会互相插队：
    // 开机自动建的那个会话刚发完事件，重建的全量就把状态清了，
    // 而那些事件因为「seq <= resumeAt」被当成旧消息丢掉——会话还在，内容没了
    let seeded = false
    /**
     * **等渲染层喊「我准备好了」再发全量，不要在 `did-finish-load` 时推。**
     *
     * `did-finish-load` 那一刻页面确实加载完了，但 React 还没跑完第一轮 effect，
     * `onReplay` 的监听还没挂上——推过去的全量落进空气里。
     *
     * 首次启动看不出来：紧接着的种子会话是走增量到达的，界面照样有东西。
     * **重载才原形毕露**——那时没有种子，一切都指望这份全量：
     * 侧栏空的、正文卡在「正在打开工作区…」，而磁盘上会话一个不少。
     */
    ipcMain.on("omni:hello", (event) => {
      // **认发来 hello 的那扇窗，不认启动时那扇。**
      //
      // 原来写的是 `event.sender !== win.webContents`，闭包捕获的是启动时那个
      // `win`；而 macOS 上 ⌘W 关窗不退应用，再点 Dock 会**建一扇新窗**。
      // 那时旧窗已销毁，这行不是「比较为假然后 return」——是**读
      // `win.webContents` 直接抛 TypeError: Object has been destroyed**，
      // 被全局 uncaughtException 兜住只写进日志。于是 rebuild 一次都不跑：
      // 新窗口侧栏空的、引擎选择器空的，点「新建会话」宿主真把进程起起来了，
      // 界面什么都不出现，点几次多几个进程，全程不报错。
      const target = BrowserWindow.fromWebContents(event.sender)
      if (target === null || target.isDestroyed()) return
      void rebuild(attached, event.sender)
        .then((recent) => {
          if (seeded) return undefined
          seeded = true
          return seedDefaultThread(attached, defaultWorksite(homedir()), devPrompt(), recent)
        })
        .catch((error: unknown) => {
          log.write("error", "ipc", `全量重建失败：${String(error)}`)
        })
    })
    // 开发钩子只挂一次，和重建是两回事——它们不依赖会话，也不该在重载时重复挂
    win.webContents.once("did-finish-load", () => {
      installDevHooks(win, attached, log)
    })
    /**
     * 退出时**等回收跑完**再真的退。
     *
     * 原来是 `void attached.host.dispose()`——发出去就不管了，应用当场退出。
     * 空闲的引擎恰好没事（主进程一死，OS 关掉 stdio 管道，等价于回收阶梯第一步），
     * **但正在跑工具的时候退，就漏一整棵进程树**：codex、它拉起的 zsh、
     * 构建进程全部存活并挂到 ppid 1。子进程是 `detached` 的，父死不连坐。
     * 而那正好是一个有写/执行权限的无头 agent 继续在你仓库里跑。
     *
     * 硬超时 8 秒：回收阶梯本身最长 7 秒（3+3+1），再多给一点余量。
     * **超时也要退**——一个退不掉的应用比漏一个进程更糟。
     */
    let quitting = false
    app.on("before-quit", (event) => {
      if (quitting) return
      quitting = true
      event.preventDefault()
      const deadline = new Promise<void>((resolve) => setTimeout(resolve, 8000))
      void Promise.race([shutdown(attached, log), deadline]).then(() => {
        clearMarker()
        app.exit(0)
      })
    })
  })
}

/**
 * 收摊：先停引擎，再把在途的日志写完。
 *
 * **顺序不能反**：`dispose` 里还会 emit 事件（`gate.settleAll()` 把挂着的
 * 审批落定），那些也要落盘。
 */
async function shutdown(attached: Attached, logger: Logger): Promise<void> {
  await attached.host.dispose().catch((error: unknown) => {
    logger.write("error", "app", `退出时回收引擎失败：${String(error)}`)
  })
  await attached.journal.flush().catch(() => undefined)
}

/**
 * 有人又双击了一次图标（或者在终端里又跑了一次）。
 *
 * 把已经开着的那扇窗举到前面。**静默退出是不行的**——那样第二下点击
 * 看起来就是「点了没反应」，而人接下来会点第三下、第四下。
 */
app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win === undefined) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
