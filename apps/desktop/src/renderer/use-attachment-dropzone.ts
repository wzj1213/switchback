import { useEffect, useRef, useState } from "react"
import {
  blockedDropHint,
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

function inspect(transfer: DataTransfer, enabled: boolean, editable: boolean): DropHint {
  return editable
    ? hoverHint(reviewAttachments(filesOf(transfer.items)), enabled)
    : blockedDropHint()
}

function keepSame(previous: DropHint | undefined, next: DropHint): DropHint {
  return previous?.tone === next.tone && previous.text === next.text ? previous : next
}

interface Options {
  enabled: boolean
  editable: boolean
  drop: (files: FileList | null) => void
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

function listeners(
  depth: React.RefObject<number>,
  setHint: React.Dispatch<React.SetStateAction<DropHint | undefined>>,
  current: React.RefObject<Options>,
): Record<"dragenter" | "dragover" | "dragleave" | "drop", (event: DragEvent) => void> {
  return {
    dragenter: (event) => {
      const transfer = transferOf(event)
      if (transfer === undefined) return
      event.preventDefault()
      depth.current += 1
      setHint(inspect(transfer, current.current.enabled, current.current.editable))
    },
    dragover: (event) => {
      const transfer = transferOf(event)
      if (transfer === undefined) return
      event.preventDefault()
      const next = inspect(transfer, current.current.enabled, current.current.editable)
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
      setHint(undefined)
      if (current.current.editable) current.current.drop(transfer.files)
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
 * 祖先画布的 DOM 入口，实际接不接仍由事件目标裁决。最新能力与可编辑态放 ref，
 * 拖动中切状态也立即生效。
 */
export function useAttachmentDropzone(
  enabled: boolean,
  editable: boolean,
  drop: (files: FileList | null) => void,
): { hint: DropHint | undefined } {
  const [hint, setHint] = useState<DropHint>()
  const depth = useRef(0)
  const current = useRef<Options>({ enabled, editable, drop })
  current.current = { enabled, editable, drop }
  useEffect(() => listenForFiles(listeners(depth, setHint, current)), [])
  return { hint }
}
