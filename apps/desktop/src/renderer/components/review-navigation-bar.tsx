import type { ReviewFile } from "../../shared/review.js"
import { ChevronIcon } from "./icons.js"
import { useMessages } from "../i18n.js"
import { REVIEW_NAV } from "./review-navigation-bar.messages.js"

export function ReviewNavigationBar({ files, active, onPick, wrap, onWrap, fixedWrap = false }: {
  files: readonly ReviewFile[]
  active: string | undefined
  onPick: (rel: string) => void
  wrap: boolean
  onWrap: (wrap: boolean) => void
  fixedWrap?: boolean
}): React.JSX.Element {
  const m = useMessages(REVIEW_NAV)
  const at = files.findIndex((file) => file.rel === active)
  return (
    <div className="review-nav" aria-label={m.label}>
      <button className="rv__tool" type="button" aria-label={m.prev} disabled={at <= 0}
        onClick={() => { const file = files[at - 1]; if (file !== undefined) onPick(file.rel) }}>
        <ChevronIcon size={13} />
      </button>
      <span className="review-nav__position" aria-live="polite">{m.position(at + 1, files.length)}</span>
      <button className="rv__tool review-nav__next" type="button" aria-label={m.next}
        disabled={at < 0 || at >= files.length - 1}
        onClick={() => { const file = files[at + 1]; if (file !== undefined) onPick(file.rel) }}>
        <ChevronIcon size={13} />
      </button>
      <button type="button" className="rv__seg" aria-pressed={wrap || fixedWrap} disabled={fixedWrap}
        title={fixedWrap ? m.fixedWrap : m.wrapTip} onClick={() => { onWrap(!wrap) }}>
        {m.wrap}
      </button>
    </div>
  )
}
