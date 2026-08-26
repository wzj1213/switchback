import { useEffect, useState } from "react"
import type { Thread } from "@omni/protocol"
import type { itemsOf, lanesOf } from "@omni/store"
import type { ComposerDrafts } from "../composer-drafts.js"
import type { ComposerFileReference } from "../file-references.js"
import { fileReference, newFileReferences } from "../file-references.js"
import type { useApp } from "../useApp.js"
import type { scopeWorkbench } from "../workbench.js"
import { WorkbenchPane } from "./WorkbenchPane.js"

interface Props {
  app: ReturnType<typeof useApp>
  thread: Thread
  lanes: ReturnType<typeof lanesOf>
  items: ReturnType<typeof itemsOf>
  stamp: string
  drafts: ComposerDrafts
  state: ReturnType<typeof scopeWorkbench>
  setReference: React.Dispatch<
    React.SetStateAction<(ComposerFileReference & { threadId: string }) | undefined>
  >
  full: boolean
  onFull: () => void
}

export function ThreadWorkbench(props: Props): React.JSX.Element {
  const { app, thread, lanes, items, stamp, state, setReference } = props
  const { shell } = app
  const [notice, setNotice] = useState<{ text: string; at: number }>()
  useEffect(() => { setNotice(undefined) }, [state.file?.path, state.page, state.visible])
  useEffect(() => {
    if (notice === undefined) return undefined
    const timer = window.setTimeout(() => { setNotice(undefined) }, 5000)
    return () => { window.clearTimeout(timer) }
  }, [notice])
  return (
    <WorkbenchPane
      state={state}
      thread={thread}
      lanes={lanes}
      items={items}
      stamp={stamp}
      notice={notice?.text}
      full={props.full}
      onFull={props.onFull}
      onActivity={shell.openActivity}
      onFiles={shell.openFiles}
      onPickLane={shell.openAside}
      onActivityIndex={shell.activityIndex}
      onPickFile={shell.openFile}
      onFileIndex={shell.fileIndex}
      onReference={(target) => {
        const path = fileReference(target.cwd, target.path).path
        const text = props.drafts.read(target.threadId)?.text ?? ""
        if (newFileReferences(text, [path]).length === 0) {
          setNotice((before) => ({
            text: "这个文件已经在输入框中，没有重复添加。",
            at: (before?.at ?? 0) + 1,
          }))
          return
        }
        setNotice(undefined)
        setReference((before) => ({
          threadId: target.threadId,
          path,
          at: (before?.at ?? 0) + 1,
        }))
        shell.hideWorkbench()
      }}
      onHide={shell.hideWorkbench}
      onReveal={app.reveal}
      onCopy={app.copy}
      searchFiles={app.searchFiles}
    />
  )
}
