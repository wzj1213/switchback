import { EventEmitter } from "node:events"
import type { FSWatcher } from "node:fs"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { watchPreviewFile, type StartDirectoryWatch } from "./file-preview-watch.js"

describe("文件预览监听", () => {
  it("只响应目标文件，并在停止时关闭目录 watcher", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchback-preview-watch-"))
    try {
      const target = join(root, "app.ts")
      await writeFile(target, "export const before = true\n")
      const changed = vi.fn()
      const close = vi.fn()
      const emitter = new EventEmitter() as FSWatcher
      Object.assign(emitter, { close })
      let listener: Parameters<StartDirectoryWatch>[1] | undefined
      const watchedRoot = await realpath(root)
      const start: StartDirectoryWatch = vi.fn((directory, onChange) => {
        expect(directory).toBe(watchedRoot)
        listener = onChange
        return emitter
      })
      const stop = await watchPreviewFile({
        value: { threadId: "th-1", cwd: root, path: "app.ts" },
        touched: () => false,
        owns: () => true,
        changed,
        start,
      })
      listener?.("change", "other.ts")
      listener?.("rename", "app.ts")
      expect(changed).toHaveBeenCalledTimes(1)
      stop?.()
      expect(close).toHaveBeenCalledOnce()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("伪造工作区或未授权的外部文件不会启动 watcher", async () => {
    const root = await mkdtemp(join(tmpdir(), "switchback-preview-watch-root-"))
    const outside = await mkdtemp(join(tmpdir(), "switchback-preview-watch-outside-"))
    try {
      const target = join(outside, "secret.ts")
      await writeFile(target, "secret\n")
      const start = vi.fn()
      const cases = [
        { owns: () => false, touched: () => true },
        { owns: () => true, touched: () => false },
      ]
      for (const guards of cases) {
        await expect(watchPreviewFile({
          value: { threadId: "th-1", cwd: root, path: target },
          changed: () => undefined,
          start,
          ...guards,
        })).resolves.toBeUndefined()
      }
      expect(start).not.toHaveBeenCalled()
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
