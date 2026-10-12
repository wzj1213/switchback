import type { Thread } from "@switchback/protocol"
import { SwitchbackMark } from "./switchback-mark.js"
import { FolderIcon } from "./icons-folder.js"

/**
 * 空会话说明工作区和开始方式；接管后仍为空才解释历史正文未搬入。
 *
 * `pending`（远程窗口）：正文还在路上。**这时不能说「开始在 X 中工作」**——
 * 会话明明有内容，只是还没传过来，那句话是确定的假话（`remote/bodies.ts`）。
 */
export function TranscriptBlank({ thread, pending = false }: { thread: Thread; pending?: boolean }): React.JSX.Element {
  if (pending) {
    return (
      <div className="blank">
        <SwitchbackMark />
        <p className="blank__title">正在取这条会话的内容…</p>
        <p className="blank__description">它在那台机器上，打开时才传过来。</p>
        <p className="blank__path" title={thread.cwd}><FolderIcon size={14} /><bdi>{thread.cwd}</bdi></p>
      </div>
    )
  }
  return (
    <div className="blank">
      <SwitchbackMark />
      <p className="blank__title">
        {thread.adopted === true ? (
          "继续这段工作"
        ) : (
          <>
            开始在 <strong>{thread.title}</strong> 中工作
          </>
        )}
      </p>
      <p className="blank__description">
        {thread.status === "starting" ? "正在连接引擎…" : "描述你要完成的工作，或拖入相关文件。"}
      </p>
      <p className="blank__path" title={thread.cwd}><FolderIcon size={14} /><bdi>{thread.cwd}</bdi></p>
      {thread.adopted === true ? (
        <p className="blank__note">
          这条是从引擎那边接过来的。<strong>前面聊过什么它都记得</strong>，
          只是这次没有拿到可展示的历史正文；接着聊不会丢掉引擎里的上下文。
        </p>
      ) : null}
    </div>
  )
}
