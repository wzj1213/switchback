import { isAbsolute, resolve } from "node:path"
import type { Event, ThreadId } from "@omni/protocol"
import { createWorksite, type Worksite } from "@omni/worksite"

export interface WorksiteSearch {
  note: (event: Event) => void
  noteHistory: (events: readonly Event[]) => void
  owns: (threadId: ThreadId, cwd: string) => boolean
  search: (request: unknown) => Promise<readonly string[]>
}

export interface OwnedWorksite {
  threadId: ThreadId
  cwd: string
}

export type WorksiteGuard = (threadId: ThreadId, cwd: string) => boolean

interface State {
  byThread: Map<ThreadId, string>
  owners: Map<string, Set<ThreadId>>
  cache: Map<string, Worksite>
  make: (cwd: string) => Worksite
  cap: number
}

const QUERY_CHARS = 256
const INDEXES = 12

function cwdOf(raw: string): string | undefined {
  return isAbsolute(raw) ? resolve(raw) : undefined
}

export function ownedWorksite(value: unknown, owns: WorksiteGuard): OwnedWorksite | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const req = value as Partial<OwnedWorksite>
  if (typeof req.threadId !== "string" || req.threadId === "") return undefined
  if (typeof req.cwd !== "string" || req.cwd === "") return undefined
  return owns(req.threadId, req.cwd) ? { threadId: req.threadId, cwd: req.cwd } : undefined
}

function release(state: State, threadId: ThreadId): void {
  const cwd = state.byThread.get(threadId)
  if (cwd === undefined) return
  state.byThread.delete(threadId)
  const owners = state.owners.get(cwd)
  owners?.delete(threadId)
  if (owners !== undefined && owners.size > 0) return
  state.owners.delete(cwd)
  state.cache.get(cwd)?.invalidate()
  state.cache.delete(cwd)
}

function remember(state: State, threadId: ThreadId, rawCwd: string): void {
  const cwd = cwdOf(rawCwd)
  if (cwd === undefined || state.byThread.get(threadId) === cwd) return
  release(state, threadId)
  state.byThread.set(threadId, cwd)
  const owners = state.owners.get(cwd) ?? new Set<ThreadId>()
  owners.add(threadId)
  state.owners.set(cwd, owners)
}

function note(state: State, event: Event): void {
  if (event.type === "thread.started" || event.type === "thread.updated") {
    remember(state, event.thread.id, event.thread.cwd)
  } else if (event.type === "thread.removed") {
    release(state, event.threadId)
  }
}

function indexOf(state: State, cwd: string): Worksite {
  const cached = state.cache.get(cwd)
  if (cached !== undefined) {
    state.cache.delete(cwd)
    state.cache.set(cwd, cached)
    return cached
  }
  const site = state.make(cwd)
  state.cache.set(cwd, site)
  if (state.cache.size <= state.cap) return site
  const oldest = state.cache.keys().next()
  if (!oldest.done) {
    state.cache.get(oldest.value)?.invalidate()
    state.cache.delete(oldest.value)
  }
  return site
}

function owns(state: State, threadId: ThreadId, rawCwd: string): boolean {
  const cwd = cwdOf(rawCwd)
  return cwd !== undefined && state.byThread.get(threadId) === cwd
}

async function search(state: State, request: unknown): Promise<readonly string[]> {
  if (typeof request !== "object" || request === null) return []
  const { cwd: rawCwd, query: rawQuery } = request as { cwd?: unknown; query?: unknown }
  if (typeof rawCwd !== "string" || typeof rawQuery !== "string") return []
  const cwd = cwdOf(rawCwd)
  if (cwd === undefined || !state.owners.has(cwd)) return []
  const query = rawQuery.slice(0, QUERY_CHARS)
  return (await indexOf(state, cwd).search(query)).map((hit) => hit.path)
}

export function createWorksiteSearch(
  make: (cwd: string) => Worksite = createWorksite,
  cap = INDEXES,
): WorksiteSearch {
  const state: State = {
    byThread: new Map(), owners: new Map(), cache: new Map(), make, cap: Math.max(1, Math.floor(cap)),
  }
  return {
    note: (event) => { note(state, event) },
    noteHistory: (events) => { for (const event of events) note(state, event) },
    owns: (threadId, cwd) => owns(state, threadId, cwd),
    search: (request) => search(state, request),
  }
}
