/**
 * 侧问模式那枚芯片，摆在输入区那一排里。
 *
 * **这一句不进正文——发之前一眼看得见。** 反过来的代价是真的：
 * 你以为在交代任务，其实发进了侧通道，那一句就白打了。
 * 所以它用强调色，而落在转录区的那张答案卡反倒不上色（见 `.asidecard`）。
 */
import { CloseIcon } from "./icons-panel.js"
import { useMessages } from "../i18n.js"
import { ASIDE_CHIP } from "./aside-chip.messages.js"

export function AsideChip({ onExit }: { onExit: () => void }): React.JSX.Element {
  const m = useMessages(ASIDE_CHIP)
  return (
    <span className="composer__asidechip">
      {m.label}
      {/* 那一排收成图标时这半句先让位（见 items-composer.css）：「侧问」两个字
          和变了色的发送键已经说明这一句去哪儿。不带前导空格——芯片自带 4px 间距 */}
      <span className="composer__asidewhy">{m.why}</span>
      <button
        type="button"
        className="composer__asideoff"
        data-tip={m.exitTip}
        aria-label={m.exit}
        onClick={onExit}
      >
        <CloseIcon size={13} />
      </button>
    </span>
  )
}
