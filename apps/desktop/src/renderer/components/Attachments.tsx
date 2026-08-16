import { CopyIcon } from "./icons.js"

/**
 * 输入框上方那排附件。
 *
 * **必须显示出来。** 贴完图什么都不变的话，人不知道它收没收到——
 * 而这件事出错的方式恰好是「静默地没收到」，跑完一轮才发现模型压根没看见图。
 */
export function Attachments({
  paths,
  onRemove,
}: {
  paths: readonly string[]
  onRemove: (path: string) => void
}): React.JSX.Element | null {
  if (paths.length === 0) return null
  return (
    <div className="attach">
      {paths.map((path) => (
        <span key={path} className="attach__chip" title={path}>
          <CopyIcon size={12} />
          {/* 只显示文件名——路径又长又是自动生成的，摆出来占满一行还什么都没说 */}
          <span className="attach__name">{path.split("/").pop() ?? path}</span>
          <button
            type="button"
            className="attach__drop"
            aria-label="去掉这个附件"
            onClick={() => {
              onRemove(path)
            }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  )
}
