/// <reference types="vite/client" />
import type { Command, Event } from "@omni/protocol"

/** 与 preload 的 `Sealed` / `Replay` 同形。跨进程的形状只能靠约定对齐。 */
interface Sealed {
  seq: number
  event: Event
}

interface Settings {
  theme: "system" | "light" | "dark"
  pinned: readonly string[]
  defaultEngine: string
  defaultTrust: "read-only" | "auto-edit" | "full"
}

interface Replay {
  events: readonly Event[]
  resumeAt: number
}

declare global {
  interface Window {
    /** 由 preload 注入的唯一通道，形状见 src/preload/index.ts */
    omni: {
      send: (command: Command) => void
      pickFolder: () => Promise<string | undefined>
      onMenu: (handler: (action: string) => void) => () => void
      onDevFind: (handler: (query: string) => void) => () => void
      find: (request: { query: string; next?: boolean; forward?: boolean }) => Promise<{
        active: number
        total: number
      }>
      stopFind: () => void
      copy: (text: string) => void
      reveal: (path: string) => void
      settings: (patch?: Partial<Settings>) => Promise<Settings>
      appInfo: () => Promise<{ version: string; dataDir: string }>
      worksite: (cwd: string) => Promise<{ branch?: string; dirty?: boolean }>
      openEngines: () => void
      diagnose: () => void
      searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
      subscribe: (onEvents: (sealed: readonly Sealed[]) => void) => () => void
      onReplay: (handler: (replay: Replay) => void) => () => void
      resync: (after: number) => Promise<{ events: readonly Sealed[] } | { reset: true }>
    }
  }
}

export {}
