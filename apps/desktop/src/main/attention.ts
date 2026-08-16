import { app, Notification } from "electron"
import type { BrowserWindow } from "electron"
import type { Event } from "@omni/protocol"

/**
 * 「有人在等你」——审批挂起时的系统通知与 Dock 角标。
 *
 * ## 为什么非有不可
 *
 * 审批是**唯一一个 agent 会停下来等人的地方**。而人在等的时候多半切走做别的事了
 * ——回来才发现它十分钟前就停在那儿。这不是打扰，这是这个应用**唯一**
 * 需要主动出声的时刻。
 *
 * ## 三条克制
 *
 * - **窗口在前台就不弹通知**：你已经看见了，再弹一次是纯噪声。角标照挂，
 *   因为它可能挂在别的会话上、被折叠着。
 * - **一次挂起只响一次**：同一张卡不会因为界面重渲染再响。
 * - **点通知把窗口举到前面**，不是打开一个新窗口。人要的是回到现场。
 */
export interface Attention {
  /** 每条出去的事件都过一遍。只挑审批相关的。 */
  note: (event: Event) => void
  /** 应用退出前清角标，免得留在 Dock 上。 */
  clear: () => void
}

export function createAttention(windows: () => readonly BrowserWindow[]): Attention {
  const pending = new Set<string>()
  const announced = new Set<string>()

  const focused = (): boolean => windows().some((w) => !w.isDestroyed() && w.isFocused())

  const badge = (): void => {
    // Dock 角标只有 macOS 有；别的平台静默跳过（`app.badgeCount` 在 Windows 上
    // 需要额外的 overlay 图标，那是另一件事，不在这儿假装做了）
    if (process.platform !== "darwin") return
    app.badgeCount = pending.size
  }

  const raise = (): void => {
    const win = windows().find((w) => !w.isDestroyed())
    if (win === undefined) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  return {
    note: (event) => {
      const seen = approvalOf(event)
      if (seen === undefined) return
      if (seen.pending) {
        if (pending.has(seen.id)) return
        pending.add(seen.id)
        badge()
        if (focused() || announced.has(seen.id)) return
        announced.add(seen.id)
        new Notification({
          title: "omni 在等你确认",
          body: seen.summary,
          silent: false,
        })
          .on("click", raise)
          .show()
        return
      }
      pending.delete(seen.id)
      announced.delete(seen.id)
      badge()
    },
    clear: () => {
      pending.clear()
      announced.clear()
      if (process.platform === "darwin") app.badgeCount = 0
    },
  }
}

/** 这条事件是不是在说「某张审批卡的状态变了」。 */
function approvalOf(event: Event): { id: string; pending: boolean; summary: string } | undefined {
  if (event.type !== "item.started" && event.type !== "item.updated") return undefined
  const item = event.item
  if (item.kind !== "approval") return undefined
  return { id: item.id, pending: item.status === "pending", summary: item.summary }
}
