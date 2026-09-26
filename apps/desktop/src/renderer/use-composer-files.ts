import { useCallback, useEffect, useRef } from "react"
import type { useAttachments } from "./useAttachments.js"
import type { ComposerFileReference } from "./file-references.js"
import { failedDropHint } from "./attachment-feedback.js"
import { useAttachmentDropzone } from "./use-attachment-dropzone.js"
import { referencedText } from "./composer-blocks.js"
import { quoteLabel } from "./review-quote.js"
import type { DraftBlocks } from "./use-draft-blocks.js"

function focusAfterSurfaceCloses(focus: () => void): void {
  focus()
  requestAnimationFrame(() => {
    requestAnimationFrame(focus)
  })
}

/**
 * 拖进来、贴进来、手选进来的文件。
 *
 * **图片进附件数组，其他文件进输入框上方那排芯片**（`DraftBlocks`）。
 * 上一版是把路径写成正文里的一行 `@绝对路径`——为什么换掉，
 * 见 `composer-blocks.ts` 开头。发出去的字一个都没变。
 *
 * 去重的基准是**「这一刻已经引用了哪些文件」**（`referencedText`）：
 * 手打过 `@src/a.ts` 之后再拖同一个文件进来，不该多一枚芯片。
 */
export function useComposerFiles(options: {
  attach: ReturnType<typeof useAttachments>
  blocks: DraftBlocks
  canAttach: boolean
  editable: boolean
  cwd: string
  text: string
  focus: () => void
  onFilesDropped: () => void
  reference?: ComposerFileReference
}): {
  dropzone: ReturnType<typeof useAttachmentDropzone>
  paste: (items: DataTransferItemList | null) => Promise<void>
  pick: () => Promise<void>
} {
  const addFiles = options.blocks.addFiles
  const addPaste = options.blocks.addPaste
  const sent = referencedText(options.text, options.blocks.blocks)
  const seenReference = useRef(options.reference?.at ?? 0)
  useEffect(() => {
    const reference = options.reference
    if (reference === undefined || reference.at === seenReference.current || !options.editable)
      return
    seenReference.current = reference.at
    if (reference.quote === undefined) addFiles([reference.path])
    else addPaste(reference.quote, quoteLabel(reference.quote))
    options.focus()
  }, [addFiles, addPaste, options.editable, options.focus, options.reference])
  const drop = useCallback(
    (files: FileList | null) => {
      const result = options.attach.drop(files, options.cwd, sent)
      addFiles(result.references)
      if ((files?.length ?? 0) === 0) return undefined
      if (!result.accepted) {
        return result.notice === undefined ? undefined : failedDropHint(result.notice)
      }
      options.onFilesDropped()
      focusAfterSurfaceCloses(options.focus)
      return undefined
    },
    [addFiles, options.attach.drop, options.cwd, options.focus, options.onFilesDropped, sent],
  )
  const paste = useCallback(
    async (items: DataTransferItemList | null) => {
      addFiles(await options.attach.paste(items, options.cwd, sent))
    },
    [addFiles, options.attach.paste, options.cwd, sent],
  )
  const pick = useCallback(async () => {
    addFiles(await options.attach.pick(options.cwd, sent))
    options.focus()
  }, [addFiles, options.attach.pick, options.cwd, options.focus, sent])
  return {
    dropzone: useAttachmentDropzone(options.canAttach, options.editable, drop),
    paste,
    pick,
  }
}
