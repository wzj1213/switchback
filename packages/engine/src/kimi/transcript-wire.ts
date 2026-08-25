import type { KimiToolDisplay } from "./wire.js"

export interface KimiTranscriptPage {
  items: readonly KimiTranscriptEntry[]
  has_more: boolean
}

export type KimiTranscriptEntry =
  KimiTranscriptTurn | KimiTranscriptMarker | { kind: string; [key: string]: unknown }

export interface KimiTranscriptMarker {
  kind: "marker"
  markerId: string
  marker: string
  payload?: unknown
  at?: string
}

export interface KimiTranscriptTurn {
  kind: "turn"
  turnId: string
  origin?: unknown
  prompt?: string
  startedAt?: string
  endedAt?: string
  state: "completed" | "failed" | "cancelled" | "running"
  error?: string
  steps: readonly KimiTranscriptStep[]
}

export interface KimiTranscriptStep {
  ordinal?: number
  state?: "running" | "completed" | "interrupted" | "failed"
  finishReason?: string
  endReason?: string
  endMessage?: string
  frames: readonly KimiTranscriptFrame[]
}

export type KimiTranscriptFrame =
  | { kind: "text"; frameId: string; role: "assistant" | "user"; text: string }
  | { kind: "thinking"; frameId: string; text: string }
  | {
      kind: "tool"
      frameId: string
      toolCallId: string
      name: string
      state: "running" | "done" | "error"
      input?: unknown
      output?: unknown
      display?: KimiToolDisplay
      error?: string
      inputText?: string
    }
  | {
      kind: "notice"
      frameId: string
      level: "error" | "warning" | "info"
      message: string
      detail?: unknown
    }
