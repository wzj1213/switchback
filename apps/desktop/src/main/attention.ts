import { app, Notification } from "electron"
import type { BrowserWindow } from "electron"
import type { Event, ThreadId, TurnId } from "@omni/protocol"
import { humanize } from "../shared/failure.js"

/**
 * 「有人在等你」「它跑完了」「它跑挂了」——出声的三件事，以及 Dock 角标。
 *
 * ## 为什么非有不可
 *
 * 这个应用的用法就是「交代一件事，然后去干别的」。而它上一版**只在审批时出声**：
 * 你交代完切走，agent 四分钟后跑完了、或者三十秒就崩了，屏幕上一点动静都没有——
 * 你只能自己想起来切回去看一眼。**不看着它的时候它什么都不说**，那这个应用
 * 就只能被看着用，等于把它最大的好处丢了。
 *
 * 审批仍然是最要紧的那一件：它是**唯一一个 agent 会停下来等人的地方**，
 * 人回来才发现它十分钟前就停在那儿。
 *
 * ## 三条克制
 *
 * - **窗口在前台就不弹通知**：你已经看见了，再弹一次是纯噪声。角标照挂，
 *   因为它可能挂在别的会话上、被折叠着。
 * - **一次挂起只响一次**：同一张卡不会因为界面重渲染再响。
 * - **点通知把窗口举到前面**，不是打开一个新窗口。人要的是回到现场。
 * - **短轮次不出声**：15 秒以内跑完的，你八成还盯着屏幕（阈值和转录区那块秒表
 *   共用一个理由：三秒的事摆个计时器只是噪声）。
 * - **自己按停的不出声**：`interrupted` 是你刚做的动作，报告它等于回声。
 *
 * ## 一个已知的洞，写在这儿而不是假装覆盖
 *
 * 「窗口在前台、但你看的是**另一条**会话」时收不到任何信号——主进程不知道
 * 渲染层选中的是谁。老实按「窗口是否前台」抑制，宁可少响一次。
 * 真要补，得让渲染层把当前选中的会话报上来，那是另一条通道。
 */
export interface Attention {
  /** 每条出去的事件都过一遍。挑审批、轮次开始与收工。 */
  note: (event: Event) => void
  /** 应用退出前清角标，免得留在 Dock 上。 */
  clear: () => void
}

/** 一轮跑起来时记下的那点东西。收工时要靠它说「哪条会话、跑了多久」。 */
interface Running {
  threadId: ThreadId
  startedAt: number
}

/** 多久以内跑完的不出声。和转录区那块秒表共用一个阈值与理由。 */
const QUIET_MS = 15_000

export function createAttention(windows: () => readonly BrowserWindow[]): Attention {
  const pending = new Set<string>()
  const announced = new Set<string>()
  /** 会话标题：通知要说清是哪一条。从 thread 那几条事件顺手记，不加协议字段。 */
  const titles = new Map<ThreadId, string>()

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

  /** 通知的正文：会话名打头——你可能同时开着四条，不说是哪条等于没说。 */
  const tell = (threadId: ThreadId, body: string): void => {
    if (focused()) return
    new Notification({ title: titles.get(threadId) ?? "omni", body, silent: false }).on("click", raise).show()
  }
  const turns = watchTurns(tell)

  return {
    note: (event) => {
      if (event.type === "thread.started" || event.type === "thread.updated") {
        titles.set(event.thread.id, event.thread.title)
      }
      if (event.type === "thread.renamed") titles.set(event.threadId, event.title)
      turns.note(event)
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
      titles.clear()
      if (process.platform === "darwin") app.badgeCount = 0
    },
  }
}

/**
 * 一轮跑完要不要出声。**自己攒 turnId → 会话与起点**，不加协议字段：
 * `turn.started` 带的 `Turn` 里本来就有这两样。
 */
export function watchTurns(
  tell: (threadId: ThreadId, body: string) => void,
  now: () => number = Date.now,
): { note: (event: Event) => void } {
  const running = new Map<TurnId, Running>()
  const note = (event: Event): void => {
    if (event.type === "turn.started") {
      running.set(event.turn.id, { threadId: event.turn.threadId, startedAt: event.turn.startedAt })
      return
    }
    if (event.type !== "turn.completed") return
    const was = running.get(event.turnId)
    running.delete(event.turnId)
    // **自己按停的不报**：那是你刚做的动作，报告它等于回声
    if (was === undefined || event.status === "interrupted") return
    if (event.status === "failed") {
      // 原文不丢——横幅里那份仍然是全的，这里只取给人看的那一句
      tell(was.threadId, `跑挂了：${humanize(event.error ?? "引擎没有说原因").text}`)
      return
    }
    if (now() - was.startedAt < QUIET_MS) return
    tell(was.threadId, `跑完了，用了 ${spent(now() - was.startedAt)}`)
  }
  return { note }
}

/**
 * 一段时长的人话说法。
 *
 * **和渲染层那个 `spent` 是同一套措辞**，但不共用实现：那边住在 `renderer/status.ts`，
 * 而那个文件 import 了一串只有渲染层才有的东西（工具动词表、推理小标题）。
 * 为一个七行的格式化函数把整条依赖链拖进主进程，代价比抄七行大得多——
 * **改措辞时两处一起改**，这句话就是给下一个人看的。
 */
function spent(ms: number): string {
  const total = Math.floor(ms / 1000)
  if (total < 60) return `${String(total)} 秒`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return seconds === 0 ? `${String(minutes)} 分` : `${String(minutes)} 分 ${String(seconds)} 秒`
}

/** 这条事件是不是在说「某张审批卡的状态变了」。 */
function approvalOf(event: Event): { id: string; pending: boolean; summary: string } | undefined {
  if (event.type !== "item.started" && event.type !== "item.updated") return undefined
  const item = event.item
  if (item.kind !== "approval") return undefined
  return { id: item.id, pending: item.status === "pending", summary: item.summary }
}
