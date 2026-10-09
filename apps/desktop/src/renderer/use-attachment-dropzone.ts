import { useEffect, useRef, useState } from "react"
import {
  hasFileItems,
  hoverHint,
  reviewAttachments,
  type DropHint,
} from "./attachment-feedback.js"

function filesOf(items: DataTransferItemList): readonly Pick<File, "type" | "size">[] {
  return Array.from(items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile() ?? { type: item.type, size: 1 })
}

function isFileTransfer(transfer: DataTransfer): boolean {
  return Array.from(transfer.types).includes("Files") || hasFileItems(transfer.items)
}

function inspect(transfer: DataTransfer, enabled: boolean): DropHint {
  return hoverHint(reviewAttachments(filesOf(transfer.items)), enabled)
}

function keepSame(previous: DropHint | undefined, next: DropHint): DropHint {
  return previous?.tone === next.tone && previous.text === next.text ? previous : next
}

interface Options {
  enabled: boolean
  drop: (files: FileList | null) => DropHint | undefined
}

const TASK_SURFACE = ".main, .workbench:not([hidden]), .rv"

function inTaskSurface(event: DragEvent): boolean {
  const target = event.target
  return target instanceof Element && target.closest(TASK_SURFACE) !== null
}

function transferOf(event: DragEvent): DataTransfer | undefined {
  const transfer = event.dataTransfer
  return transfer !== null && inTaskSurface(event) && isFileTransfer(transfer)
    ? transfer
    : undefined
}

function cancelExpiry(expiry: React.RefObject<number | undefined>): void {
  if (expiry.current === undefined) return
  window.clearTimeout(expiry.current)
  expiry.current = undefined
}

function expireHint(
  expiry: React.RefObject<number | undefined>,
  setHint: React.Dispatch<React.SetStateAction<DropHint | undefined>>,
  hint: DropHint,
): void {
  cancelExpiry(expiry)
  expiry.current = window.setTimeout(() => {
    setHint((shown) => shown === hint ? undefined : shown)
    expiry.current = undefined
  }, 5000)
}

function listeners(
  depth: React.RefObject<number>,
  expiry: React.RefObject<number | undefined>,
  setHint: React.Dispatch<React.SetStateAction<DropHint | undefined>>,
  current: React.RefObject<Options>,
): Record<"dragenter" | "dragover" | "dragleave" | "drop", (event: DragEvent) => void> {
  return {
    dragenter: (event) => {
      const transfer = transferOf(event)
      if (transfer === undefined) return
      event.preventDefault()
      cancelExpiry(expiry)
      depth.current += 1
      setHint(inspect(transfer, current.current.enabled))
    },
    dragover: (event) => {
      const transfer = transferOf(event)
      if (transfer === undefined) return
      event.preventDefault()
      const next = inspect(transfer, current.current.enabled)
      transfer.dropEffect = next.tone === "ready" ? "copy" : "none"
      setHint((previous) => keepSame(previous, next))
    },
    dragleave: (event) => {
      if (!inTaskSurface(event) || depth.current === 0) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setHint(undefined)
    },
    drop: (event) => {
      const transfer = transferOf(event)
      if (transfer === undefined) return
      event.preventDefault()
      depth.current = 0
      const feedback = current.current.drop(transfer.files)
      setHint(feedback)
      if (feedback !== undefined) expireHint(expiry, setHint, feedback)
    },
  }
}

function listenForFiles(events: ReturnType<typeof listeners>): () => void {
  window.addEventListener("dragenter", events.dragenter)
  window.addEventListener("dragover", events.dragover)
  window.addEventListener("dragleave", events.dragleave)
  window.addEventListener("drop", events.drop)
  return () => {
    window.removeEventListener("dragenter", events.dragenter)
    window.removeEventListener("dragover", events.dragover)
    window.removeEventListener("dragleave", events.dragleave)
    window.removeEventListener("drop", events.drop)
  }
}

/**
 * 当前任务画布都是落点：正文、已打开的工作台或审核组；侧栏与模态不接，
 * 避免文件拖拽和会话排序 / 设置面板互相抢。监听挂 window 是因为 Composer 拿不到
 * 祖先画布的 DOM 入口，实际接不接仍由事件目标裁决。最新能力放 ref，
 * 拖动中切状态也立即生效。历史会话照样接：它的输入框能发（发话时宿主先接回引擎）。
 */
export function useAttachmentDropzone(
  enabled: boolean,
  drop: (files: FileList | null) => DropHint | undefined,
): { hint: DropHint | undefined } {
  const [hint, setHint] = useState<DropHint>()
  const depth = useRef(0)
  const expiry = useRef<number | undefined>(undefined)
  const current = useRef<Options>({ enabled, drop })
  current.current = { enabled, drop }
  useEffect(() => {
    const stop = listenForFiles(listeners(depth, expiry, setHint, current))
    return () => { stop(); cancelExpiry(expiry) }
  }, [])
  return { hint }
}
