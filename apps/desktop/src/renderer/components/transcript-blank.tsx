import type { Thread } from "@omni/protocol"
import { OmniMark } from "./omni-mark.js"
import { FolderIcon } from "./icons-folder.js"

/** 空会话说明工作区和开始方式；接管后仍为空才解释历史正文未搬入。 */
export function TranscriptBlank({ thread }: { thread: Thread }): React.JSX.Element {
  return (
    <div className="blank">
      <OmniMark />
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
