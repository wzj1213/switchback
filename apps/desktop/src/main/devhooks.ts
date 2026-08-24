import type { BrowserWindow } from "electron"
import {
  scheduleDevCompare,
  scheduleDevFilter,
  scheduleDevFind,
  scheduleDevInterrupt,
  scheduleDevOpenSelect,
  scheduleDevProbe,
  scheduleDevReload,
  scheduleDevReview,
  scheduleDevRowMenu,
  scheduleDevSettings,
  scheduleDevShot,
  scheduleDevSwitch,
  scheduleDevThreadOps,
} from "./devtools.js"
import type { Attached } from "./host.js"
import type { Logger } from "./log.js"

/**
 * 开发钩子的挂载点。**只在开发模式下挂一次**（见 `index.ts` 的 `did-finish-load`）。
 *
 * 从 `index.ts` 拆出来是行数闸门逼的，但边界也对：这一整块和产品行为无关，
 * 它存在的唯一理由是让验收脚本能在没有人手的情况下按下界面上的东西。
 */
export function installDevHooks(win: BrowserWindow, attached: Attached, logger: Logger): void {
  scheduleDevFind(win)
  scheduleDevInterrupt(win)
  scheduleDevReload(win)
  scheduleDevCompare(win)
  scheduleDevReview(win)
  scheduleDevFilter(win)
  scheduleDevOpenSelect(win)
  scheduleDevRowMenu(win)
  scheduleDevSettings(win)
  scheduleDevProbe(win, (m: string) => {
    logger.write("info", "dev", m)
  })
  scheduleDevSwitch(win, (kind, to) => {
    const threadId = attached.lastThreadId()
    if (threadId === undefined) return
    void attached.host
      .dispatch(
        kind === "fork"
          ? { type: "thread.fork", threadId, to }
          : { type: "thread.handoff", threadId, to },
      )
      .catch((error: unknown) => {
        attached.report(error, threadId)
      })
  })
  scheduleDevThreadOps(win, (op) => {
    const threadId = attached.lastThreadId()
    if (threadId === undefined) return
    void attached.host
      .dispatch(
        op.kind === "rename"
          ? { type: "thread.rename", threadId, title: op.title }
          : { type: "thread.delete", threadId },
      )
      .catch((error: unknown) => {
        attached.report(error, threadId)
      })
  })
  scheduleDevShot(win)
}
