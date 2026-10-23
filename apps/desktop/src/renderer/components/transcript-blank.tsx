import type { Thread } from "@switchback/protocol"
import { SwitchbackMark } from "./switchback-mark.js"
import { FolderIcon } from "./icons-folder.js"
import { useMessages } from "../i18n.js"
import { TRANSCRIPT_BLANK } from "./transcript-blank.messages.js"

/**
 * 空会话说明工作区和开始方式；接管后仍为空才解释历史正文未搬入。
 *
 * `pending`（远程窗口）：正文还在路上。**这时不能说「开始在 X 中工作」**——
 * 会话明明有内容，只是还没传过来，那句话是确定的假话（`remote/bodies.ts`）。
 */
export function TranscriptBlank({ thread, pending = false }: { thread: Thread; pending?: boolean }): React.JSX.Element {
  const m = useMessages(TRANSCRIPT_BLANK)
  if (pending) {
    return (
      <div className="blank">
        <SwitchbackMark />
        <p className="blank__title">{m.fetching}</p>
        <p className="blank__description">{m.fetchingNote}</p>
        <p className="blank__path" title={thread.cwd}><FolderIcon size={14} /><bdi>{thread.cwd}</bdi></p>
      </div>
    )
  }
  return (
    <div className="blank">
      <SwitchbackMark />
      <p className="blank__title">
        {thread.adopted === true ? (
          m.resume
        ) : (
          <>
            {m.startBefore}<strong>{thread.title}</strong>{m.startAfter}
          </>
        )}
      </p>
      <p className="blank__description">
        {thread.status === "starting" ? m.connecting : m.describe}
      </p>
      <p className="blank__path" title={thread.cwd}><FolderIcon size={14} /><bdi>{thread.cwd}</bdi></p>
      {thread.adopted === true ? (
        <p className="blank__note">
          {m.adoptedBefore}<strong>{m.adoptedStrong}</strong>{m.adoptedAfter}
        </p>
      ) : null}
    </div>
  )
}
