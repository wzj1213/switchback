/// <reference types="vite/client" />
import type { Command, Event } from "@omni/protocol"

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
      searchFiles: (cwd: string, query: string) => Promise<readonly string[]>
      subscribe: (onEvents: (events: readonly Event[]) => void) => () => void
    }
  }
}

export {}
