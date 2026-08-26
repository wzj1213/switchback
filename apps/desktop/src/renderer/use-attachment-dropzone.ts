import { useRef, useState } from "react"
import { hasFileItems, hoverHint, reviewAttachments, type DropHint } from "./attachment-feedback.js"

function filesOf(items: DataTransferItemList): readonly Pick<File, "type" | "size">[] {
  return Array.from(items).filter((item) => item.kind === "file").map((item) => (
    item.getAsFile() ?? { type: item.type, size: 1 }
  ))
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

type Bind = Pick<React.HTMLAttributes<HTMLDivElement>, "onDragEnter" | "onDragOver" | "onDragLeave" | "onDrop">

export function useAttachmentDropzone(
  enabled: boolean,
  drop: (files: FileList | null) => void,
): { hint: DropHint | undefined; bind: Bind } {
  const [hint, setHint] = useState<DropHint>()
  const depth = useRef(0)
  return {
    hint,
    bind: {
      onDragEnter: (event) => {
        if (!isFileTransfer(event.dataTransfer)) return
        event.preventDefault()
        depth.current += 1
        setHint(inspect(event.dataTransfer, enabled))
      },
      onDragOver: (event) => {
        if (!isFileTransfer(event.dataTransfer)) return
        event.preventDefault()
        const next = inspect(event.dataTransfer, enabled)
        event.dataTransfer.dropEffect = next.tone === "ready" ? "copy" : "none"
        // dragover 每秒会来几十次；提示没变就别让整个 composer 跟着重绘。
        setHint((previous) => keepSame(previous, next))
      },
      onDragLeave: () => {
        // Chromium 在离开窗口边缘时可能清空 DataTransfer；depth 才是这次拖放的所有权。
        if (depth.current === 0) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setHint(undefined)
      },
      onDrop: (event) => {
        if (!isFileTransfer(event.dataTransfer)) return
        event.preventDefault()
        depth.current = 0
        setHint(undefined)
        drop(event.dataTransfer.files)
      },
    },
  }
}
