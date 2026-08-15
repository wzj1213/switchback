import { changesOf } from "../tool.js"
import type { Item } from "@omni/protocol"

/**
 * 「N 个文件已更改 +A −B」，挂在输入框上方。
 *
 * codex 有同样一枚。它回答的是**「我可以走了吗」**——agent 跑了十分钟，
 * 你要提交之前想知道它总共动了多少。这件事在 transcript 里是散的
 * （分布在十几条编辑行上），没人加起来的话，只能自己往回翻着数。
 *
 * 一个文件都没动就不显示：一枚常驻的「0 个文件」只是噪声。
 */
export function Changed({ items }: { items: readonly Item[] }): React.JSX.Element | null {
  const { files, added, removed } = changesOf(items)
  if (files === 0) return null
  return (
    <div className="changed">
      <span className="changed__pill">
        {files} 个文件已更改
        {added > 0 ? <span className="diffstat__add">+{added}</span> : null}
        {removed > 0 ? <span className="diffstat__del">−{removed}</span> : null}
      </span>
    </div>
  )
}
