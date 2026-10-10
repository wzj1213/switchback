import { app, ipcMain, Notification } from "electron"
import type { BrowserWindow } from "electron"
import type { Event, ThreadId, TurnId } from "@switchback/protocol"
import { humanize } from "../shared/failure.js"
import type { NotifyMode } from "../shared/settings.js"
import { watchQuestions, type QuestionChange } from "./attention-questions.js"

/**
 * 「有人在等你批/答」「它跑完了」「它跑挂了」——出声的三类事，以及 Dock 角标。
 *
 * ## 为什么非有不可
 *
 * 这个应用的用法就是「交代一件事，然后去干别的」。而它上一版**只在审批时出声**：
 * 你交代完切走，agent 四分钟后跑完了、或者三十秒就崩了，屏幕上一点动静都没有——
 * 你只能自己想起来切回去看一眼。**不看着它的时候它什么都不说**，那这个应用
 * 就只能被看着用，等于把它最大的好处丢了。
 *
 * 审批与结构化问题仍然是最要紧的两件：agent 会停下来等人，
 * 人回来才发现它十分钟前就停在那儿。
 *
 * ## 三条克制
 *
 * - **正在看这条会话就不弹通知**：你已经看见了，再弹一次是纯噪声。窗口虽在前台、
 *   但人看的是另一条会话时仍然要响；角标照挂，因为审批可能被折叠着。
 * - **一次挂起只响一次**：同一张卡不会因为界面重渲染再响。
 * - **点通知把窗口举到前面**，不是打开一个新窗口。人要的是回到现场。
 * - **短轮次不出声**：15 秒以内跑完的，你八成还盯着屏幕（阈值和转录区那块秒表
 *   共用一个理由：三秒的事摆个计时器只是噪声）。
 * - **自己按停的不出声**：`interrupted` 是你刚做的动作，报告它等于回声。
 *
 * 渲染层只通过一条窄 IPC 报当前会话 id；没有报上来（启动首帧或 preload 故障）时
 * 仍按「窗口在前台」抑制，避免应用刚启动就乱响。
 */
export interface Attention {
  /** 每条出去的事件都过一遍。挑审批、问题、轮次开始与收工。 */
  note: (event: Event) => void
  /** 渲染层此刻正在看的会话。没有会话时传 undefined。 */
  viewing: (threadId: ThreadId | undefined) => void
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

/**
 * 除了系统通知之外再送一份的地方（远程推送）。
 *
 * **和系统通知共用桌面端判据**（正在看这条会话就不出声），但**不共用全部理由**：
 * 「一次挂起只响一次」那条对推送同样成立，而「有人正看着这条会话」
 * 还要在 `remote/relay.ts` 再判一次——那一层才知道远程端正在看什么。
 */
export type Relay = (threadId: ThreadId, title: string, body: string) => void

interface FocusableWindow {
  isDestroyed: () => boolean
  isFocused: () => boolean
}

/**
 * 这件事是不是已经在人眼前。
 *
 * 空 threadId 是审批事件没法从 turn 反查归属的保守兜底；选中会话还没报上来也是。
 * 两种情况都只在窗口真的有焦点时抑制，不拿未知冒充「人在看另一条」。
 */
export function isAttending(
  windows: readonly FocusableWindow[],
  viewing: ThreadId | undefined,
  threadId: ThreadId,
): boolean {
  const focused = windows.some((window) => !window.isDestroyed() && window.isFocused())
  return focused && (viewing === undefined || threadId === "" || viewing === threadId)
}

/** renderer 只报一个会话 id；Electron 能力仍留在主进程。 */
function connectViewing(attention: Attention): Attention {
  ipcMain.on("switchback:viewing", (_event, threadId: unknown) => {
    attention.viewing(typeof threadId === "string" && threadId !== "" ? threadId : undefined)
  })
  return attention
}

function updateBadge(size: number): void {
  // Dock 角标只有 macOS 有；别的平台需要额外 overlay 图标，不在这儿假装做了。
  if (process.platform === "darwin") app.badgeCount = size
}

function rememberTitle(titles: Map<ThreadId, string>, event: Event): void {
  if (event.type === "thread.started" || event.type === "thread.updated") {
    titles.set(event.thread.id, event.thread.title)
  }
  if (event.type === "thread.renamed") titles.set(event.threadId, event.title)
}

interface QuestionAttention {
  pending: Set<string>
  announced: Set<string>
  badge: () => void
  attending: (threadId: ThreadId) => boolean
  enabled: () => boolean
  tell: (threadId: ThreadId, body: string) => void
}

function noteQuestion(change: QuestionChange, state: QuestionAttention): void {
  const key = `question:${change.threadId}:${change.id}`
  if (!change.pending) {
    state.pending.delete(key)
    state.announced.delete(key)
    state.badge()
    return
  }
  if (state.pending.has(key)) return
  state.pending.add(key)
  state.badge()
  if (!state.enabled() || state.attending(change.threadId) || state.announced.has(key)) return
  state.announced.add(key)
  state.tell(change.threadId, change.summary)
}

function raiseFirst(windows: readonly BrowserWindow[]): void {
  const win = windows.find((window) => !window.isDestroyed())
  if (win === undefined) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 设置按函数读取，用户修改后立即生效；角标本身不受通知开关影响。 */
export function createAttention(
  windows: () => readonly BrowserWindow[],
  relay?: Relay,
  mode: () => NotifyMode = () => "all",
): Attention {
  const pending = new Set<string>()
  const announced = new Set<string>()
  /** 会话标题：通知要说清是哪一条。从 thread 那几条事件顺手记，不加协议字段。 */
  const titles = new Map<ThreadId, string>()
  const view = { threadId: undefined as ThreadId | undefined }
  const attending = (threadId: ThreadId): boolean => isAttending(windows(), view.threadId, threadId)

  const badge = (): void => updateBadge(pending.size)

  const raise = (): void => raiseFirst(windows())

  /** 通知的正文：会话名打头——你可能同时开着四条，不说是哪条等于没说。 */
  const tell = (threadId: ThreadId, body: string): void => {
    const title = titles.get(threadId) ?? "Switchback"
    new Notification({ title, body, silent: false }).on("click", raise).show()
    // 同一个出口再送一份到手机上。**不在这里判「要不要推」**——
    // 那要知道谁正看着哪条会话，而那是远程那一层才有的信息
    relay?.(threadId, title, body)
  }
  const turns = watchTurns((threadId, body) => {
    if (mode() === "all" && !attending(threadId)) tell(threadId, body)
  })
  const questionState: QuestionAttention = {
    pending, announced, badge, attending, enabled: () => mode() !== "off", tell,
  }
  const questions = watchQuestions((change) => noteQuestion(change, questionState))

  return connectViewing({
    note: (event) => {
      rememberTitle(titles, event)
      turns.note(event)
      questions.note(event)
      const seen = approvalOf(event, turns.threadOf)
      if (seen === undefined) return
      if (!seen.pending) {
        pending.delete(seen.id)
        announced.delete(seen.id)
        badge()
        return
      }
      if (pending.has(seen.id)) return
      pending.add(seen.id)
      badge()
      // **审批不走 `tell`**：那一条在「只有审批」这一档要闭嘴，而这一条不能。
      // 角标已经挂上了，下面这一步只决定要不要出声
      if (mode() === "off" || attending(seen.threadId) || announced.has(seen.id)) return
      announced.add(seen.id)
      askFor(seen, titles.get(seen.threadId) ?? "Switchback 在等你确认", raise, relay)
    },
    viewing: (threadId) => {
      view.threadId = threadId
    },
    clear: () => {
      pending.clear()
      announced.clear()
      titles.clear()
      questions.clear()
      view.threadId = undefined
      updateBadge(0)
    },
  })
}

/**
 * 「它停下来等你了」这一声。
 *
 * **正文用 `summary`（工具名 + 一句概述），不放命令原文**——
 * 通知会显示在锁屏上，而命令里可能带着路径甚至参数。
 * 同一句话再推一份到手机上：agent 停在那儿无超时地等，而人多半不在电脑前。
 */
function askFor(
  seen: { summary: string; threadId: ThreadId },
  title: string,
  raise: () => void,
  relay: Relay | undefined,
): void {
  new Notification({ title: "Switchback 在等你确认", body: seen.summary, silent: false })
    .on("click", raise)
    .show()
  relay?.(seen.threadId, title, seen.summary)
}

/**
 * 一轮跑完要不要出声。**自己攒 turnId → 会话与起点**，不加协议字段：
 * `turn.started` 带的 `Turn` 里本来就有这两样。
 */
export function watchTurns(
  tell: (threadId: ThreadId, body: string) => void,
  now: () => number = Date.now,
): { note: (event: Event) => void; threadOf: (turnId: TurnId) => ThreadId | undefined } {
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
  // 审批卡上只有 `turnId`，而推送要能直达那条会话。这张表本来就在，顺手开一个口
  return { note, threadOf: (turnId) => running.get(turnId)?.threadId }
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

/**
 * 这条事件是不是在说「某张审批卡的状态变了」。
 *
 * `threadId` 是推送要用的——通知点开之后得能直达那条会话，
 * 而 item 上没有会话 id，只能从 `turnId` 反查。这里用 `turns` 那张表
 * （`watchTurns` 已经在维护它），所以要把它传进来。
 */
function approvalOf(
  event: Event,
  threadOf: (turnId: TurnId) => ThreadId | undefined,
): { id: string; pending: boolean; summary: string; threadId: ThreadId } | undefined {
  if (event.type !== "item.started" && event.type !== "item.updated") return undefined
  const item = event.item
  if (item.kind !== "approval") return undefined
  return {
    id: item.id,
    pending: item.status === "pending",
    summary: item.summary,
    threadId: threadOf(item.turnId) ?? "",
  }
}
