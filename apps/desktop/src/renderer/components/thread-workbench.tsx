import type { Thread } from "@omni/protocol"
import type { itemsOf, lanesOf } from "@omni/store"
import type { ComposerFileReference } from "../file-references.js"
import { fileReference } from "../file-references.js"
import type { useApp } from "../useApp.js"
import type { scopeWorkbench } from "../workbench.js"
import { WorkbenchPane } from "./WorkbenchPane.js"

interface Props {
  app: ReturnType<typeof useApp>
  thread: Thread
  lanes: ReturnType<typeof lanesOf>
  items: ReturnType<typeof itemsOf>
  stamp: string
  state: ReturnType<typeof scopeWorkbench>
  setReference: React.Dispatch<
    React.SetStateAction<(ComposerFileReference & { threadId: string }) | undefined>
  >
}

export function ThreadWorkbench(props: Props): React.JSX.Element {
  const { app, thread, lanes, items, stamp, state, setReference } = props
  const { shell } = app
  return (
    <>
      {state.visible ? (
        <button
          type="button"
          className="workbench__scrim"
          tabIndex={-1}
          aria-label="收起任务工作台"
          onClick={shell.hideWorkbench}
        />
      ) : null}
      <WorkbenchPane
        state={state}
        thread={thread}
        lanes={lanes}
        items={items}
        stamp={stamp}
        onActivity={shell.openActivity}
        onFiles={shell.openFiles}
        onPickLane={shell.openAside}
        onActivityIndex={shell.activityIndex}
        onPickFile={shell.openFile}
        onFileIndex={shell.fileIndex}
        onReference={(target) => {
          const path = fileReference(target.cwd, target.path).path
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
    </>
  )
}
