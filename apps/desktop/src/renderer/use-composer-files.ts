import { useCallback, useEffect, useRef } from "react"
import type { useAttachments } from "./useAttachments.js"
import { appendFileReferences, type ComposerFileReference } from "./file-references.js"
import { failedDropHint } from "./attachment-feedback.js"
import { useAttachmentDropzone } from "./use-attachment-dropzone.js"

function focusAfterSurfaceCloses(focus: () => void): void {
  focus()
  requestAnimationFrame(() => {
    requestAnimationFrame(focus)
  })
}

export function useComposerFiles(options: {
  attach: ReturnType<typeof useAttachments>
  canAttach: boolean
  editable: boolean
  cwd: string
  text: string
  setText: React.Dispatch<React.SetStateAction<string>>
  focus: () => void
  onFilesDropped: () => void
  reference?: ComposerFileReference
}): {
  dropzone: ReturnType<typeof useAttachmentDropzone>
  paste: (items: DataTransferItemList | null) => Promise<void>
  pick: () => Promise<void>
} {
  const addReferences = useCallback(
    (paths: readonly string[]) => {
      if (paths.length > 0) options.setText((text) => appendFileReferences(text, paths))
    },
    [options.setText],
  )
  const seenReference = useRef(options.reference?.at ?? 0)
  useEffect(() => {
    const reference = options.reference
    if (reference === undefined || reference.at === seenReference.current || !options.editable)
      return
    seenReference.current = reference.at
    addReferences([reference.path])
    options.focus()
  }, [addReferences, options.editable, options.focus, options.reference])
  const drop = useCallback(
    (files: FileList | null) => {
      const result = options.attach.drop(files, options.cwd, options.text)
      addReferences(result.references)
      if ((files?.length ?? 0) === 0) return undefined
      if (!result.accepted) {
        return result.notice === undefined ? undefined : failedDropHint(result.notice)
      }
      options.onFilesDropped()
      focusAfterSurfaceCloses(options.focus)
      return undefined
    },
    [addReferences, options.attach.drop, options.cwd, options.focus, options.onFilesDropped, options.text],
  )
  const paste = useCallback(
    async (items: DataTransferItemList | null) => {
      addReferences(await options.attach.paste(items, options.cwd, options.text))
    },
    [addReferences, options.attach.paste, options.cwd, options.text],
  )
  const pick = useCallback(async () => {
    addReferences(await options.attach.pick(options.cwd, options.text))
    options.focus()
  }, [addReferences, options.attach.pick, options.cwd, options.focus, options.text])
  return {
    dropzone: useAttachmentDropzone(options.canAttach, options.editable, drop),
    paste,
    pick,
  }
}
