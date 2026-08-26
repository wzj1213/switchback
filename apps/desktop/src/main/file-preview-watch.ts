import { watch, type FSWatcher } from "node:fs"
import { basename, dirname } from "node:path"
import { ipcMain, type IpcMainEvent } from "electron"
import type { TouchedFiles } from "./touched.js"
import type { WorksiteSearch } from "./worksite-search.js"
import { previewWatchTarget, type PreviewGuard, type WorkspaceGuard } from "./file-preview.js"

export type StartDirectoryWatch = (
  directory: string,
  changed: (event: string, filename: string | Buffer | null) => void,
) => FSWatcher

const startDirectoryWatch: StartDirectoryWatch = (directory, changed) =>
  watch(directory, { persistent: false }, changed)

export async function watchPreviewFile(options: {
  value: unknown
  touched: PreviewGuard
  owns: WorkspaceGuard
  changed: () => void
  start?: StartDirectoryWatch
}): Promise<(() => void) | undefined> {
  const target = await previewWatchTarget(options.value, options.touched, options.owns)
  if (target === undefined) return undefined
  const wanted = basename(target)
  const watcher = (options.start ?? startDirectoryWatch)(dirname(target), (_event, filename) => {
    if (filename !== null && String(filename) !== wanted) return
    options.changed()
  })
  const state = { stopped: false }
  const stop = (): void => {
    if (state.stopped) return
    state.stopped = true
    watcher.close()
  }
  watcher.on("error", stop)
  return stop
}

interface WatchRequest {
  id: string
  threadId: string
  cwd: string
  path: string
}

function requestOf(value: unknown): WatchRequest | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const req = value as Partial<WatchRequest>
  if (typeof req.id !== "string" || req.id === "" || req.id.length > 128) return undefined
  if (typeof req.threadId !== "string" || typeof req.cwd !== "string" || typeof req.path !== "string") {
    return undefined
  }
  return req.threadId === "" || req.cwd === "" || req.path === "" ? undefined : req as WatchRequest
}

function watchKey(senderId: number, id: string): string {
  return `${String(senderId)}\u0000${id}`
}

function stopSender(records: Map<string, () => void>, requested: Set<string>, senderId: number): void {
  const prefix = `${String(senderId)}\u0000`
  for (const key of [...requested]) if (key.startsWith(prefix)) requested.delete(key)
  for (const [key, stop] of records) {
    if (!key.startsWith(prefix)) continue
    stop()
    records.delete(key)
  }
}

function stopOne(records: Map<string, () => void>, requested: Set<string>, key: string): void {
  requested.delete(key)
  records.get(key)?.()
  records.delete(key)
}

interface WatchContext {
  touched: TouchedFiles
  worksites: WorksiteSearch
  records: Map<string, () => void>
  requested: Set<string>
}

function startOne(event: IpcMainEvent, value: unknown, context: WatchContext): void {
  const req = requestOf(value)
  if (req === undefined) return
  const key = watchKey(event.sender.id, req.id)
  stopOne(context.records, context.requested, key)
  context.requested.add(key)
  void watchPreviewFile({
    value: req,
    touched: context.touched.allows,
    owns: context.worksites.owns,
    changed: () => { if (!event.sender.isDestroyed()) event.sender.send("omni:fileChanged", req.id) },
  }).then((stop) => {
    if (stop === undefined) return
    if (!context.requested.has(key)) stop(); else context.records.set(key, stop)
  }).catch(() => { context.requested.delete(key) })
}

/** 每个 renderer 只持有当前预览对应的目录 watcher；卸载、换文件或崩溃都会回收。 */
export function installFilePreviewWatch(touched: TouchedFiles, worksites: WorksiteSearch): void {
  const records = new Map<string, () => void>()
  const requested = new Set<string>()
  const senders = new Set<number>()
  const context = { touched, worksites, records, requested }
  ipcMain.on("omni:watchFile", (event, value: unknown) => {
    if (!senders.has(event.sender.id)) {
      senders.add(event.sender.id)
      event.sender.once("destroyed", () => {
        stopSender(records, requested, event.sender.id)
        senders.delete(event.sender.id)
      })
    }
    startOne(event, value, context)
  })
  ipcMain.on("omni:unwatchFile", (event, id: unknown) => {
    if (typeof id !== "string") return
    stopOne(records, requested, watchKey(event.sender.id, id))
  })
}
