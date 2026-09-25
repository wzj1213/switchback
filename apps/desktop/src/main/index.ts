import { join } from "node:path"
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron"
import { homedir } from "node:os"
import { installAttachChannel } from "./attach.js"
import { installProjectDocChannel } from "./projectdoc.js"
import { createEngineVersions, installEngineVersionChannel } from "./enginever.js"
import { installEngineDoorChannels } from "./enginedoors.js"
import { installSelfUpdateChannel } from "./selfupdate.js"
import { installChatDirChannel } from "./chatdir.js"
import { fixPath } from "./loginpath.js"
import { attachHost, rebuild, seedDefaultThread, type Attached } from "./host.js"
import { createSinks, windowSink } from "./sink.js"
import { attachRemote } from "./remote/index.js"
import { installMenu } from "./menu.js"
import { installContextMenu } from "./context-menu.js"
import { installFind } from "./find.js"
import { createLogger, type Logger } from "./log.js"
import { exportReport } from "./diagnose.js"
import { ensureEngineFile } from "./engines.js"
import { clearMarker, installCrashReporter, watchProcesses } from "./crash.js"
import { announce, checkForUpdate, feedOf, fetchText } from "./update.js"
import { createSettings } from "./settings.js"
import { installWorksiteChannel } from "./worksite.js"
import { installReviewChannel } from "./work-review-channel.js"
import { installSearchChannel } from "./search.js"
import { installEnvChannel } from "./envconfig.js"
import { loadBounds, trackBounds } from "./window-state.js"
import { applyDevTheme, defaultWorksite, devPrompt } from "./devtools.js"
import { installDevHooks } from "./devhooks.js"
import { quitNow, shouldStayOpen } from "./quit.js"
import { openExternalSafely } from "./external-url.js"
import { readBuildInfo } from "./build-info.js"
import { engineEnabled } from "../shared/engine-access.js"
import { installActivity } from "./activity.js"
import { installEngineSettings } from "./engine-settings.js"
import { installFilePreviewChannel } from "./file-preview.js"
import { installFilePreviewWatch } from "./file-preview-watch.js"
import { createTouchedFiles } from "./touched.js"
import { createAttachmentFiles } from "./attachment-files.js"
import { createWorksiteSearch } from "./worksite-search.js"

/**
 * Electron 主进程。
 *
 * 现在只负责开窗。`@omni/host` 接进来之后，引擎子进程会住在这一侧，
 * 渲染层永远不直接 spawn 任何东西——这条边界是故意的：
 * 渲染层崩了不该带走正在跑的引擎。
 */

const isDev = process.env["ELECTRON_RENDERER_URL"] !== undefined
const buildInfo = readBuildInfo(app.getAppPath())

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
 * 引擎版本的探测结果。**在这里建、显式传下去**，理由和 `settings` 一样：
 * 它有状态（缓存），而这个仓库不允许状态挂在模块上。
 */
/**
 * 装完 / 更新完之后，让引擎清单重探一遍。
 *
 * **可变槽是为了解开一个环**：通道必须比宿主先挂（`installChannels` 在
 * `attachHost` 之前），所以 `engineVersions` 建得比 `attached` 早，拿不到它。
 * 同 `relay` 那处的写法。宿主还没起时这一格是空的——那时也确实没有清单要刷。
 */
const engineRefresh: { run?: (id?: string) => Promise<unknown> } = {}
const engineVersions = createEngineVersions(log, {
  claudeExecutable: buildInfo.claudeExecutable,
  onChanged: () => {
    void engineRefresh.run?.().catch((error: unknown) => {
      log.write("warn", "engines", `装完之后重探引擎失败：${String(error)}`)
    })
  },
})

/**
 * 「会话碰过哪些文件 / 真正拥有哪个工作区」的名册。预览先凭 worksiteSearch 核根，
 * 工作区外的文件再凭 touched 放行（见 `file-preview.ts`）。
 *
 * **在这里建**：通道比宿主先挂（`installChannels` 在 `attachHost` 之前），
 * 而两边说的必须是同一份名册。理由同 `engineVersions`——有状态，就显式传下去。
 */
const touched = createTouchedFiles()
const attachmentFiles = createAttachmentFiles(join(app.getPath("userData"), "attachments"))
const worksiteSearch = createWorksiteSearch()

/**
 * 更新检查。**没配 feed 就整个不存在**——不发请求、不起定时器、菜单里也不出现。
 * 只查不装的理由见 `update.ts`：没签名的应用装不了更新。
 */
const feed = feedOf(
  buildInfo.updateFeed === undefined ? undefined : { omni: { updateFeed: buildInfo.updateFeed } },
)

const runUpdateCheck = async (manual: boolean): Promise<void> => {
  const result = await checkForUpdate({ feed, current: app.getVersion(), fetchText })
  await announce(
    result,
    {
      ask: async (options) => (await dialog.showMessageBox({ type: "info", ...options })).response,
      open: (url) => {
        void openExternal(url)
      },
      log: (level, message) => {
        log.write(level, "update", message)
      },
    },
    manual,
  )
}

function openExternal(url: string): Promise<boolean> {
  return openExternalSafely(url, {
    open: (safe) => shell.openExternal(safe),
    report: (message) => log.write("warn", "external", message),
  })
}

/**
 * 全局兜底。**没有这两条，主进程里任何一个漏网的异常都会静默带走整个应用**——
 * 用户看到的是窗口突然消失，日志里什么都没有。
 */
process.on("uncaughtException", (error: Error) => {
  log.write("error", "main", `未捕获异常：${error.stack ?? error.message}`)
})
process.on("unhandledRejection", (reason: unknown) => {
  log.write(
    "error",
    "main",
    `未处理拒绝：${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
  )
})

function createWindow(bounds: {
  x: number
  y: number
  width: number
  height: number
}): BrowserWindow {
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 860,
    minHeight: 560,
    show: false,
    titleBarStyle: "hiddenInset",
    // 交通灯按这个高度垂直居中，**必须等于 tokens.css 的 `--topbar-h`**。
    // 顺带打开 Window Controls Overlay：CSS 能用 `env(titlebar-area-x)` 读到交通灯占到哪，
    // 收起导航时的避让量就不用再估（实测 78）。只在 macOS 上开——别的平台上
    // 它会在右上角另画一套窗口按钮。
    ...(process.platform === "darwin" ? { titleBarOverlay: { height: 48 } } : {}),
    // **和 `tokens.css` 的 `--bg` 逐字对齐。** 这个色是窗口在页面画出来之前、
    // 以及缩放时边缘露出来的那一块；对不上就会在那些时刻闪一下别的颜色。
    // 改调色板时这里必须跟着改——它是唯一一处 CSS 管不到的底色
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#202225" : "#ffffff",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
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
    void openExternal(url)
    return { action: "deny" }
  })

  // 渲染的是模型产出的 Markdown，里面可能有链接。带 target 的走上面的
  // handler 去外部浏览器；没有 target 的会**就地导航**，把整个应用页面顶掉。
  // 这里兜底：一律拦下并转给系统浏览器。
  win.webContents.on("will-navigate", (event, url) => {
    if (url === win.webContents.getURL()) return
    event.preventDefault()
    void openExternal(url)
  })

  // 右键。**Electron 不给默认菜单**，不接的话右键什么都不弹——
  // 而「选中一段话 → 右键 → 复制」是大多数人复制文字唯一会走的那条路
  installContextMenu(win.webContents)

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
    // 构建标识（短 sha）。**版本号本身回答不了「你装的是哪一次构建」**——
    // 同一个版本号可能对应好几次重打，而 bug 报告要的正是那个精确的点
    build: buildInfo.build ?? "开发版",
    dataDir: app.getPath("userData"),
  }))
  ipcMain.on("omni:openEngines", () => {
    void shell.openPath(ensureEngineFile(app.getPath("userData")))
  })
  ipcMain.on("omni:diagnose", () => {
    void exportReport(log, crash)
  })
}

/**
 * 「我准备好了，把世界给我。」
 *
 * **每次加载都重建**，不只是第一次。渲染层重载（开发期热更、崩溃恢复、
 * 用户按了 ⌘R）之后状态是空的，只补增量补不出前面的历史。
 * **重建和开会话必须串起来，不能各跑各的。** 两条独立的异步链会互相插队：
 * 开机自动建的那个会话刚发完事件，重建的全量就把状态清了，
 * 而那些事件因为「seq <= resumeAt」被当成旧消息丢掉——会话还在，内容没了。
 *
 * **等渲染层喊，不要在 `did-finish-load` 时推。** 那一刻页面确实加载完了，
 * 但 React 还没跑完第一轮 effect，`onReplay` 的监听还没挂上——推过去的全量
 * 落进空气里。首次启动看不出来（紧接着的种子会话是走增量到达的），
 * **重载才原形毕露**：侧栏空的、正文卡在「正在打开工作区…」，而磁盘上会话一个不少。
 */
function installHello(attached: Attached): void {
  const state = { seeded: false }
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
    void rebuild(attached, windowSink(target))
      .then((recent) => {
        if (state.seeded) return undefined
        state.seeded = true
        return seedDefaultThread(attached, defaultWorksite(homedir()), devPrompt(), recent)
      })
      .catch((error: unknown) => {
        log.write("error", "ipc", `全量重建失败：${String(error)}`)
      })
  })
}

/** 开发钩子。全挂在这里，`whenReady` 那段只管应用本身怎么起。 */
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
  quitNow()
  return false
}

if (!claimSingleInstance()) {
  // `app.quit()` 是异步的，这里必须挡住后面的启动流程，
  // 否则这个注定要退出的实例还是会先建窗口、先碰一遍 journal
  log.write("info", "app", "已经有一个 omni 在跑了，把那扇窗举到前面，这个实例退出")
} else {
  void bootstrap()
}

/**
 * 渲染层要用、而只有主进程做得到的那些通道，一次挂完。
 *
 * 挂在一处不是整洁癖：**漏挂一条不会报错**，只会让界面上某个按钮点了没反应，
 * 而这类沉默的失效最难查。挤在 `bootstrap` 里时它们混在窗口生命周期中间，
 * 加第十条的时候没人看得出这一段是同一类事。
 */
function installChannels(): void {
  installAppChannels()
  installWorksiteChannel(worksiteSearch)
  installSearchChannel()
  installChatDirChannel()
  installAttachChannel(attachmentFiles)
  installFilePreviewChannel(touched, worksiteSearch)
  installFilePreviewWatch(touched, worksiteSearch)
  installProjectDocChannel(worksiteSearch)
  installEngineVersionChannel(log, engineVersions)
  installEngineDoorChannels()
  installEnvChannel(log)
  installSelfUpdateChannel(log)
}

async function openMainWindow(attached: Attached): Promise<BrowserWindow> {
  installHello(attached)
  // 历史先显示，引擎探测完成后走正常增量；重载从 current() 补已知结果。
  void attached.refreshEngines().catch(attached.report)
  const win = createWindow(await loadBounds())
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void loadBounds().then(createWindow)
  })
  return win
}

function bootstrap(): Promise<void> {
  return app.whenReady().then(async () => {
    // **第一件事**：把 PATH 补成登录 shell 那一份。探测引擎、spawn 引擎都要用，
    // 而从 Dock 启动时它默认只有 `/usr/bin:/bin:/usr/sbin:/sbin`
    await fixPath(log)
    installChannels()
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
    /**
     * 引擎版本预热。**为的是设置面板打开时不用等**——它原来是打开那一刻才去
     * spawn `codex --version` + `npm view`，于是每次进设置都顿一下（见 `enginever.ts`）。
     *
     * 8 秒之后再跑：启动那几秒里主进程要探引擎、起宿主、重建全量，
     * 这件事一点都不急。
     */
    setTimeout(() => {
      engineVersions.warm()
    }, 8000)
    installFind(() => BrowserWindow.getAllWindows())
    watchProcesses(log, () => BrowserWindow.getAllWindows())
    const sinks = createSinks(() => BrowserWindow.getAllWindows())
    // **后绑**：推送要用设备表，而设备表在 `installRemote` 里；而 `attachHost`
    // 又必须先跑（`installRemote` 要它的账本）。用一个可变的槽把环解开——
    // 这一格在 `attachRemote` 之前是空的，那期间也确实没有客户端可推
    const relay: { notify?: (threadId: string, title: string, body: string) => void } = {}
    const attached = attachHost(sinks, () => BrowserWindow.getAllWindows(), log, {
      touched,
      attachmentFiles,
      worksiteSearch,
      relay: (id, title, body) => relay.notify?.(id, title, body),
      engineVisible: (id) => engineEnabled(settings.get(), id), dshProfile: () => settings.get().dsh.profile,
      notify: () => settings.get().notify,
      handoffBrief: () => settings.get().handoffBrief,
    })
    installReviewChannel(attached.baselines, attached.worksiteSearch)
    // 设置面板的「活动」那一页。**只在点进去时才扫盘**，所以挂通道不花任何东西
    installActivity(attached, log)
    // 等宿主建好再挂：设置变化才能把新清单同时推给桌面与远程端。
    installEngineSettings(settings, attached, log)
    // 环在这儿闭合：从这一刻起，装完一家引擎不必重启 omni 就能被认出来
    engineRefresh.run = attached.refreshEngines
    const remote = attachRemote({ attached, sinks, settings: settings.get, log })
    relay.notify = remote.relay.notify
    // 远程监听不阻塞本机开窗；失败已有远程设置页与日志承接。
    void remote.sync().catch((error: unknown) => log.write("warn", "remote", String(error)))
    const win = await openMainWindow(attached)
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
      // **先拦下来再问**：`preventDefault` 必须在这一拍同步调用，
      // 弹框是同步的所以顺序上没问题
      event.preventDefault()
      // **`quitting` 要在问完之后才置。** 置早了、人又点了「取消」，
      // 这个标志就永久地把确认框关掉了——第二次 ⌘Q 直接杀，
      // 而那正是这个框想拦住的事
      if (shouldStayOpen(attached.host.live(), BrowserWindow.getFocusedWindow() ?? undefined))
        return
      quitting = true
      const deadline = new Promise<void>((resolve) => setTimeout(resolve, 8000))
      void Promise.race([shutdown(attached, log, remote.close), deadline]).then(() => {
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
async function shutdown(
  attached: Attached,
  logger: Logger,
  closeRemote: () => Promise<void>,
): Promise<void> {
  // 电源断言先放开：进程马上就没了，但留一个没停的断言给系统是脏活。
  //
  // **然后是引擎先回收、远程后关。**
  //
  // 反过来（先 await closeRemote）曾经是这里的写法，而它的上界由第三方库和
  // 网络共同决定：一条正在往隧道里推前端产物、对端却卡在电梯里的连接，
  // 能让 `server.close()` 撑过外层那 8 秒的兜底——一到点就 `app.exit(0)`，
  // `host.dispose()` **一次都没跑**，于是漏掉整棵引擎进程树
  //（子进程是 detached 的，父死不连坐）。那正是这段代码本来要挡的事。
  //
  // 远程客户端收不到优雅关闭，最多是多等一次重连；漏一棵有写和执行权限的
  // 进程树没有「最多」。
  attached.awake.release()
  await attached.host.dispose().catch((error: unknown) => {
    logger.write("error", "app", `退出时回收引擎失败：${String(error)}`)
  })
  await attached.journal.flush().catch(() => undefined)
  await closeRemote().catch((error: unknown) => {
    logger.write("warn", "remote", `关闭远程服务端失败：${String(error)}`)
  })
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
  // **这条路不问。** 非 mac 上关掉最后一扇窗就是退出，而这时已经没有窗口了：
  // 弹出来的框要是被点了「取消」，应用就变成一个没有窗、没有托盘图标、
  // 只能去任务管理器里找的东西——那比静默退出更难收场
  if (process.platform !== "darwin") quitNow()
})
