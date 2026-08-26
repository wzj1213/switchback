import { useCallback } from "react"
import type { useAttachments } from "./useAttachments.js"
import { appendFileReferences } from "./file-references.js"
import { useAttachmentDropzone } from "./use-attachment-dropzone.js"

export function useComposerFiles(options: {
  attach: ReturnType<typeof useAttachments>
  canAttach: boolean
  editable: boolean
  cwd: string
  setText: React.Dispatch<React.SetStateAction<string>>
}): {
  dropzone: ReturnType<typeof useAttachmentDropzone>
  paste: (items: DataTransferItemList | null) => Promise<void>
} {
  const addReferences = useCallback((paths: readonly string[]) => {
    if (paths.length > 0) options.setText((text) => appendFileReferences(text, paths))
  }, [options.setText])
  const drop = useCallback((files: FileList | null) => {
    addReferences(options.attach.drop(files, options.cwd))
  }, [addReferences, options.attach.drop, options.cwd])
  const paste = useCallback(async (items: DataTransferItemList | null) => {
    addReferences(await options.attach.paste(items, options.cwd))
  }, [addReferences, options.attach.paste, options.cwd])
  return {
    dropzone: useAttachmentDropzone(options.canAttach, options.editable, drop),
    paste,
  }
}
