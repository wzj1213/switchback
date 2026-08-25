import type { Thread } from "@omni/protocol"
import { TerminalIcon } from "./icons-activity.js"

/** 空会话要说明工作区；接管后仍为空才说明历史正文没有搬到 omni。 */
export function TranscriptBlank({ thread }: { thread: Thread }): React.JSX.Element {
  return (
    <div className="blank">
      <div className="blank__glyph" aria-hidden="true">
        <TerminalIcon size={34} />
      </div>
      <p className="blank__title">
        {thread.adopted === true ? (
          "接着聊就行"
        ) : (
          <>
            在 <strong>{thread.title}</strong> 里做点什么？
          </>
        )}
      </p>
      <p className="blank__path">{thread.cwd}</p>
      {thread.adopted === true ? (
        <p className="blank__note">
          这条是从引擎那边接过来的。<strong>前面聊过什么它都记得</strong>，
          只是这次没有拿到可展示的历史正文；接着聊不会丢掉引擎里的上下文。
        </p>
      ) : null}
    </div>
  )
}
