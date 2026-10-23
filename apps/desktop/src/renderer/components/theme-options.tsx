import type { Settings } from "../../shared/settings.js"
import { CheckIcon } from "./icons.js"
import { useMessages } from "../i18n.js"
import { THEME_OPTIONS } from "./theme-options.messages.js"

const THEMES = ["system", "light", "dark"] as const

export function ThemeOptions({ value, onPick }: {
  value: Settings["theme"]
  onPick: (theme: Settings["theme"]) => void
}): React.JSX.Element {
  const m = useMessages(THEME_OPTIONS)
  return (
    <div className="theme-options" role="group" aria-label={m.label}>
      {THEMES.map((theme) => (
        <button key={theme} type="button" className={`theme-card theme-card--${theme}`}
          aria-pressed={value === theme} onClick={() => { onPick(theme) }}>
          <span className="theme-card__preview" aria-hidden="true">
            <span className="theme-card__rail"><i /><i /><i /></span>
            <span className="theme-card__canvas"><i /><i /><b /></span>
          </span>
          <span className="theme-card__label">{m.theme[theme]}<span className="theme-card__check"><CheckIcon size={13} /></span></span>
        </button>
      ))}
    </div>
  )
}
