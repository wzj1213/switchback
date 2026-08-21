import type { Thread } from "@omni/protocol"
import { TerminalIcon } from "./icons-activity.js"

/** 空会话要说明工作区；接管来的空白还要说明历史仍留在引擎侧。 */
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
          只是那些内容存在引擎那边、omni 这里搬不过来，所以上面是空的。 （Claude 的历史能搬，codex
          目前不行——它还没开放读取历史内容的接口。）
        </p>
      ) : null}
    </div>
  )
}
