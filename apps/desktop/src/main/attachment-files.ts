import { readdir, rm, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import type { Event, ThreadId, TurnId } from "@switchback/protocol"

export interface AttachmentFiles {
  dir: string
  note: (event: Event) => void
  noteHistory: (threadId: ThreadId, events: readonly Event[]) => void
  /**
   * 一个不是会话的持有者（没发出去的草稿，键是 `draft:<那一格>`）现在引用着哪些图。**整份替换**：
   * 草稿里去掉的那张不再算在用。给空就是放手。
   */
  hold: (owner: string, paths: readonly string[]) => void
  allow: (paths: readonly string[]) => void
  allows: (path: string) => boolean
  discard: (paths: readonly string[]) => Promise<number>
  removeThread: (threadId: ThreadId) => Promise<number>
  pruneOnce: (now: number) => Promise<number>
}

const ORPHAN_AGE_MS = 7 * 24 * 60 * 60 * 1000
const RECENT_ALLOWED = 1000

export function thumbnailSize(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return undefined
  return Math.min(2048, Math.floor(value))
}

function pathsOf(event: Event): readonly string[] {
  if (event.type === "thread.started" || event.type === "thread.updated") {
    return [
      ...(event.thread.draftAttachments ?? []),
      ...(event.thread.queuedAttachments ?? []).flat(),
    ]
  }
  if (event.type !== "item.started" && event.type !== "item.updated") return []
  return event.item.kind === "user_message" ? (event.item.attachments ?? []) : []
}

interface FileState {
  dir: string
  byThread: Map<ThreadId, Set<string>>
  references: Map<string, Set<ThreadId>>
  allowed: Map<string, true>
  turns: Map<TurnId, ThreadId>
  pruned: boolean
}

function managed(state: FileState, path: string): string | undefined {
  if (!isAbsolute(path)) return undefined
  const target = resolve(path)
  return dirname(target) === state.dir ? target : undefined
}

function remember(state: FileState, threadId: ThreadId, paths: readonly string[]): void {
  for (const raw of paths) {
    if (!isAbsolute(raw)) continue
    const path = resolve(raw)
    const owned = state.byThread.get(threadId) ?? new Set<string>()
    owned.add(path)
    state.byThread.set(threadId, owned)
    const owners = state.references.get(path) ?? new Set<ThreadId>()
    owners.add(threadId)
    state.references.set(path, owners)
  }
}

function allow(state: FileState, paths: readonly string[]): void {
  for (const raw of paths) {
    if (!isAbsolute(raw)) continue
    const path = resolve(raw)
    state.allowed.delete(path)
    state.allowed.set(path, true)
    if (state.allowed.size <= RECENT_ALLOWED) continue
    const oldest = state.allowed.keys().next()
    if (!oldest.done) state.allowed.delete(oldest.value)
  }
}

/**
 * 删之前先认引用。**除了整条路径，还按文件名认**：附件名带时间戳和随机串，不会撞名，
 * 而整条路径会因为数据目录挪过地方而对不上——改名搬家后第一次启动，会话里记的还是
 * 旧目录的路径，七天前的图就全被当成孤儿删了。按文件名认，目录怎么挪都删不到还在用的图。
 */
async function erase(state: FileState, paths: readonly string[]): Promise<number> {
  const names = new Set([...state.references.keys()].map((path) => basename(path)))
  const targets = [...new Set(paths.flatMap((path) => {
    const target = managed(state, path)
    return target === undefined || state.references.has(target) || names.has(basename(target)) ? [] : [target]
  }))]
  const removed = await Promise.all(targets.map(async (path) => {
    return rm(path, { force: true }).then(() => 1, () => 0)
  }))
  return removed.reduce((sum, count) => sum + count, 0)
}

function note(state: FileState, event: Event): void {
  if (event.type === "turn.started") {
    state.turns.set(event.turn.id, event.turn.threadId)
    return
  }
  if (event.type === "turn.completed") {
    state.turns.delete(event.turnId)
    return
  }
  if (event.type === "thread.started" || event.type === "thread.updated") {
    remember(state, event.thread.id, pathsOf(event))
    return
  }
  if (event.type !== "item.started" && event.type !== "item.updated") return
  const threadId = state.turns.get(event.item.turnId)
  if (threadId !== undefined) remember(state, threadId, pathsOf(event))
}

/** 这个持有者引用的图一概放手，返回它原来引用的那些。 */
function release(state: FileState, owner: string): string[] {
  const paths = [...(state.byThread.get(owner) ?? [])]
  state.byThread.delete(owner)
  for (const path of paths) {
    const owners = state.references.get(path)
    owners?.delete(owner)
    if (owners?.size === 0) state.references.delete(path)
  }
  return paths
}

async function removeThread(state: FileState, threadId: ThreadId): Promise<number> {
  for (const [turnId, owner] of state.turns) if (owner === threadId) state.turns.delete(turnId)
  return erase(state, release(state, threadId))
}

async function pruneOnce(state: FileState, now: number): Promise<number> {
  if (state.pruned) return 0
  state.pruned = true
  const entries = await readdir(state.dir, { withFileTypes: true }).catch(() => [])
  const old = await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
    const path = join(state.dir, entry.name)
    const info = await stat(path).catch(() => undefined)
    return info !== undefined && info.mtimeMs <= now - ORPHAN_AGE_MS ? path : undefined
  }))
  return erase(state, old.filter((path): path is string => path !== undefined))
}

export function createAttachmentFiles(rawDir: string): AttachmentFiles {
  const state: FileState = {
    dir: resolve(rawDir), byThread: new Map(), references: new Map(), allowed: new Map(),
    turns: new Map(), pruned: false,
  }

  return {
    dir: state.dir,
    note: (event) => { note(state, event) },
    noteHistory: (threadId, events) => {
      for (const event of events) remember(state, threadId, pathsOf(event))
    },
    hold: (owner, paths) => {
      release(state, owner)
      remember(state, owner, paths)
    },
    allow: (paths) => { allow(state, paths) },
    allows: (path) => {
      if (!isAbsolute(path)) return false
      const target = resolve(path)
      return managed(state, target) !== undefined || state.references.has(target) || state.allowed.has(target)
    },
    discard: (paths) => erase(state, paths),
    removeThread: (threadId) => removeThread(state, threadId),
    pruneOnce: (now) => pruneOnce(state, now),
  }
}
