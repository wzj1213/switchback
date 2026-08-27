import type { Thread } from "@omni/protocol"

/**
 * 空会话要说明工作区；接管后仍为空才说明历史正文没有搬到 omni。
 *
 * ## 不摆那个 62px 的空心圆
 *
 * 改之前这里有一个圆圈套终端图标，它**既不指示状态也不可点**，
 * 只是把标题连同它下面那一整组往下压了 70px。codex 的空屏没有图标，
 * claude 的也没有——一个纯装饰的图形恰恰是「模板感」最直接的来源。
 *
 * **冷启动那一圈仍然在**：那是 `screens.tsx` 自己的 `--spin`，
 * 它转，因为真有事情在发生。两者共用 `.blank__glyph` 的样式，
 * 这里只是不再无端用它。
 */
export function TranscriptBlank({ thread }: { thread: Thread }): React.JSX.Element {
  return (
    <div className="blank">
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
