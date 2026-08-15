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
      subscribe: (onEvent: (event: Event) => void) => () => void
    }
  }
}

export {}
