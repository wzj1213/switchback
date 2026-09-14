import type { ReviewFile } from "../../shared/review.js"
import { ChevronIcon } from "./icons.js"

export function ReviewNavigationBar({ files, active, onPick, wrap, onWrap, fixedWrap = false }: {
  files: readonly ReviewFile[]
  active: string | undefined
  onPick: (rel: string) => void
  wrap: boolean
  onWrap: (wrap: boolean) => void
  fixedWrap?: boolean
}): React.JSX.Element {
  const at = files.findIndex((file) => file.rel === active)
  return (
    <div className="review-nav" aria-label="文件导航">
      <button className="rv__tool" type="button" aria-label="上一个改动文件" disabled={at <= 0}
        onClick={() => { const file = files[at - 1]; if (file !== undefined) onPick(file.rel) }}>
        <ChevronIcon size={13} />
      </button>
      <span className="review-nav__position" aria-live="polite">{at + 1} / {files.length} 文件</span>
      <button className="rv__tool review-nav__next" type="button" aria-label="下一个改动文件"
        disabled={at < 0 || at >= files.length - 1}
        onClick={() => { const file = files[at + 1]; if (file !== undefined) onPick(file.rel) }}>
        <ChevronIcon size={13} />
      </button>
      <button type="button" className="rv__seg" aria-pressed={wrap || fixedWrap} disabled={fixedWrap}
        title={fixedWrap ? "并排视图保持换行以对齐两侧" : "切换长行自动换行"} onClick={() => { onWrap(!wrap) }}>
        自动换行
      </button>
    </div>
  )
}
