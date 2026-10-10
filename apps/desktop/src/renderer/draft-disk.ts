import type { Thread } from "@switchback/protocol"
import { NEW_DRAFT, type LoadedDrafts, type StoredDraft } from "../shared/drafts.js"

/**
 * 输入框草稿在盘上的那一份：启动时从主进程读一次，之后每次改动攒一小会儿交回去
 *（主进程再攒一会儿才落盘，见 `main/drafts.ts`）。
 */
export interface DraftSink {
  /**
   * 这条会话的草稿落在哪一格。点「+」和启动时开的临时会话共用「新会话」那一格（id 重启后会变）；
   * 分叉、重来出来的临时会话不落盘（给 undefined）——那条会话本身重启后就不在了。
   */
  slotOf: (threadId: string) => string | undefined
  /** 盘上那一份（含这次运行里交出去的）。 */
  stored: (slot: string) => StoredDraft | undefined
  /** 交一份；undefined 是删。 */
  save: (slot: string, draft: StoredDraft | undefined) => void
  /** 启动读盘时这一格有几张图已经不在了。**只报一次**，输入框据此说一声。 */
  takeMissing: (slot: string) => number | undefined
}

export interface DraftDisk extends DraftSink {
  hydrate: (loaded: LoadedDrafts) => void
  /** 攒着的立刻交出去（窗口要关、页面要重载时）。 */
  flush: () => void
}

/** 比较用：时刻不算——内容没变就不必再交一次。 */
function identity(draft: StoredDraft | undefined): string {
  return draft === undefined ? "" : JSON.stringify({ ...draft, at: 0 })
}

export function createDraftDisk(deps: {
  slotOf: (threadId: string) => string | undefined
  send: (slot: string, draft: StoredDraft | undefined) => void
  delayMs?: number
}): DraftDisk {
  const stored = new Map<string, StoredDraft>()
  const missing = new Map<string, number>()
  const pending = new Map<string, StoredDraft | undefined>()
  // 每一格上次交出去的是什么。宿主草稿那边每挂一次组件都会「忘一下」，内容其实没变，不必一遍遍往主进程送
  const sent = new Map<string, string>()
  const timer: { id?: number } = {}
  const flush = (): void => {
    if (timer.id !== undefined) window.clearTimeout(timer.id)
    delete timer.id
    for (const [slot, draft] of pending) deps.send(slot, draft)
    pending.clear()
  }
  return {
    slotOf: deps.slotOf,
    stored: (slot) => stored.get(slot),
    takeMissing: (slot) => {
      const count = missing.get(slot)
      missing.delete(slot)
      return count
    },
    hydrate: (loaded) => {
      for (const [slot, draft] of Object.entries(loaded.drafts)) {
        stored.set(slot, draft)
        sent.set(slot, identity(draft))
      }
      for (const [slot, count] of Object.entries(loaded.missing)) missing.set(slot, count)
    },
    save: (slot, draft) => {
      if ((sent.get(slot) ?? "") === identity(draft)) return
      sent.set(slot, identity(draft))
      if (draft === undefined) stored.delete(slot)
      else stored.set(slot, draft)
      pending.set(slot, draft)
      timer.id ??= window.setTimeout(flush, deps.delayMs ?? 200)
    },
    flush,
  }
}

/**
 * 这条会话的草稿落在盘上哪一格。点「+」和启动时自动开的临时会话 id 重启后会变，共用「新会话」那一格；
 * 分叉、重来出来的临时会话（带 `forkedFrom`）不落盘——那条会话本身重启后就没了，
 * 让它占住「新会话」那一格，下次点「+」就会冒出一段不相干的话。
 */
export function draftSlot(thread: Thread | undefined, threadId: string): string | undefined {
  if (thread?.provisional !== true) return threadId
  return thread.forkedFrom === undefined ? NEW_DRAFT : undefined
}
