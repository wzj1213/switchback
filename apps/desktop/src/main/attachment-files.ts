import { readdir, rm, stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import type { Event, ThreadId, TurnId } from "@omni/protocol"

export interface AttachmentFiles {
  dir: string
  note: (event: Event) => void
  noteHistory: (threadId: ThreadId, events: readonly Event[]) => void
  discard: (paths: readonly string[]) => Promise<number>
  removeThread: (threadId: ThreadId) => Promise<number>
  pruneOnce: (now: number) => Promise<number>
}

const ORPHAN_AGE_MS = 7 * 24 * 60 * 60 * 1000

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
  turns: Map<TurnId, ThreadId>
  pruned: boolean
}

function managed(state: FileState, path: string): string | undefined {
  const target = resolve(path)
  return dirname(target) === state.dir ? target : undefined
}

function remember(state: FileState, threadId: ThreadId, paths: readonly string[]): void {
  for (const raw of paths) {
    const path = managed(state, raw)
    if (path === undefined) continue
    const owned = state.byThread.get(threadId) ?? new Set<string>()
    owned.add(path)
    state.byThread.set(threadId, owned)
    const owners = state.references.get(path) ?? new Set<ThreadId>()
    owners.add(threadId)
    state.references.set(path, owners)
  }
}

async function erase(state: FileState, paths: readonly string[]): Promise<number> {
  const targets = [...new Set(paths.flatMap((path) => {
    const target = managed(state, path)
    return target === undefined || state.references.has(target) ? [] : [target]
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

async function removeThread(state: FileState, threadId: ThreadId): Promise<number> {
  const paths = [...(state.byThread.get(threadId) ?? [])]
  state.byThread.delete(threadId)
  for (const [turnId, owner] of state.turns) if (owner === threadId) state.turns.delete(turnId)
  for (const path of paths) {
    const owners = state.references.get(path)
    owners?.delete(threadId)
    if (owners?.size === 0) state.references.delete(path)
  }
  return erase(state, paths)
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
    dir: resolve(rawDir), byThread: new Map(), references: new Map(), turns: new Map(), pruned: false,
  }

  return {
    dir: state.dir,
    note: (event) => { note(state, event) },
    noteHistory: (threadId, events) => {
      for (const event of events) remember(state, threadId, pathsOf(event))
    },
    discard: (paths) => erase(state, paths),
    removeThread: (threadId) => removeThread(state, threadId),
    pruneOnce: (now) => pruneOnce(state, now),
  }
}
