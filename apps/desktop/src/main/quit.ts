import { app, BrowserWindow, dialog } from "electron"
import type { Thread } from "@switchback/protocol"
import { busy } from "./awake.js"
import type { Attached } from "./attached.js"
import { clearMarker } from "./crash.js"
import type { Logger } from "./log.js"

/**
 * ⌘Q 的时候先问一句——如果真有活在跑。
 *
 * ## 它治的是什么
 *
 * 退出是**不可撤销**的：`shutdown` 会把整棵引擎进程树回收掉（这是对的，见
 * `index.ts` 里那段论证），所以正在改的文件停在半路、正在跑的构建当场没。
 * 而 ⌘Q 就在 ⌘W 旁边，手一滑十分钟的活就没了，中间没有任何一步能反悔。
 *
 * ## 三条边界
 *
 * - **闲着的时候不问。** 每次退出都弹一个框，人三天之内就学会闭着眼睛按回车，
 *   那时它已经不是确认了。所以判据是 `busy()`：真有在跑或等审批的才问。
 * - **只对用户发起的退出问。** 自更新换包、开发钩子截完图自己退——那几处
 *   走 {@link quitNow}，它们不是人按的，弹框只会把一个自动流程卡死在那里。
 * - **点「取消」必须真的能取消。** 见 `index.ts` 里 `quitting` 的复位：
 *   那个标志一旦置上就再也不问了，取消之后第二次 ⌘Q 会直接杀掉。
 */

/**
 * 程序化退出的旗子。
 *
 * **粘住不复位**是有意的：走到这里的那几处退出都不会被取消（换包脚本已经
 * 起在外面了，截图也已经落盘了），复位它没有意义，反而多一条要想的路径。
 */
const forced = { yes: false }

/** 不问，直接退。给那几处「不是人按的」退出用。 */
export function quitNow(): void {
  forced.yes = true
  app.quit()
}

/** 这次退出是程序自己发起的吗？是的话别弹确认框。 */
export function forcedQuit(): boolean {
  return forced.yes
}

/**
 * 框里那句话。**说清楚有几条、以及退出会把它们怎么样**——
 * 「确定要退出吗？」这种问法给不出任何判断依据，人只能凭手感按。
 */
export function quitBlurb(threads: readonly Thread[]): string {
  const running = threads.filter((t) => t.status === "running").length
  // 主轮之外的权限请求（后台子 agent 在等）也算：会话状态没变，可确实有人在等你
  const waiting = threads.filter((t) => t.status === "waiting_approval" || (t.pendingApprovals?.length ?? 0) > 0).length
  const questions = threads.reduce((count, thread) => count + (thread.pendingQuestions?.length ?? 0), 0)
  const parts: string[] = []
  if (running > 0) parts.push(`${String(running)} 条正在跑`)
  if (waiting > 0) parts.push(`${String(waiting)} 条等着你批`)
  if (questions > 0) parts.push(`${String(questions)} 组等着你回答`)
  return `${parts.join("、")}。现在退出会结束它们手上的活，改到一半的文件就停在那儿了。`
}

/**
 * 要不要拦这次退出。返回 `true` 表示「拦住，别退」。
 *
 * 用同步版对话框：`preventDefault()` 已经在外面调过了，接下来必须**当场**
 * 定下退不退——异步返回时那次 quit 事件早就过去了，再想续上只能自己
 * 再发一次 `app.quit()`，那条路上还得防重入。
 */
export function shouldStayOpen(threads: readonly Thread[], win: BrowserWindow | undefined): boolean {
  if (forcedQuit() || !busy(threads)) return false
  const options = {
    type: "warning" as const,
    buttons: ["退出", "取消"],
    defaultId: 1,
    cancelId: 1,
    message: "还有活没跑完",
    detail: quitBlurb(threads),
  }
  const picked = win === undefined || win.isDestroyed()
    ? dialog.showMessageBoxSync(options)
    : dialog.showMessageBoxSync(win, options)
  return picked === 1
}

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
export function guardQuit(deps: {
  attached: Attached
  log: Logger
  closeRemote: () => Promise<void>
  /** 没发出去的草稿：收摊那几秒里渲染层可能还交过来一份，所以最后才落盘。 */
  flushDrafts: () => void
}): void {
  const { attached, log, closeRemote } = deps
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
    void Promise.race([shutdown(attached, log, closeRemote), deadline]).then(() => {
      deps.flushDrafts()
      clearMarker()
      app.exit(0)
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
  attached.egress.dispose()
  await attached.host.dispose().catch((error: unknown) => {
    logger.write("error", "app", `退出时回收引擎失败：${String(error)}`)
  })
  await attached.journal.flush().catch(() => undefined)
  await closeRemote().catch((error: unknown) => {
    logger.write("warn", "remote", `关闭远程服务端失败：${String(error)}`)
  })
}
