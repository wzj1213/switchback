import { app, dialog, type BrowserWindow } from "electron"
import type { Thread } from "@switchback/protocol"
import { busy } from "./awake.js"

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
  const waiting = threads.filter((t) => t.status === "waiting_approval").length
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
