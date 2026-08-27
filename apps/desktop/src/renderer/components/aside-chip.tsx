/**
 * 侧问模式那枚芯片，摆在输入区那一排里。
 *
 * **这一句不进正文——发之前一眼看得见。** 反过来的代价是真的：
 * 你以为在交代任务，其实发进了侧通道，那一句就白打了。
 * 所以它用强调色，而落在转录区的那张答案卡反倒不上色（见 `.asidecard`）。
 */
import { CloseIcon } from "./icons-panel.js"

export function AsideChip({ onExit }: { onExit: () => void }): React.JSX.Element {
  return (
    <span className="composer__asidechip">
      侧问 · 这一句不进正文
      <button
        type="button"
        className="composer__asideoff"
        title="退出侧问（Esc）"
        aria-label="退出侧问"
        onClick={onExit}
      >
        <CloseIcon size={13} />
      </button>
    </span>
  )
}
