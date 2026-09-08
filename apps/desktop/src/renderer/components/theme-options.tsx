import type { Settings } from "../../shared/settings.js"
import { CheckIcon } from "./icons.js"

const THEMES = [
  { id: "system", label: "跟随系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
] as const

export function ThemeOptions({ value, onPick }: {
  value: Settings["theme"]
  onPick: (theme: Settings["theme"]) => void
}): React.JSX.Element {
  return (
    <div className="theme-options" role="group" aria-label="主题">
      {THEMES.map((theme) => (
        <button key={theme.id} type="button" className={`theme-card theme-card--${theme.id}`}
          aria-pressed={value === theme.id} onClick={() => { onPick(theme.id) }}>
          <span className="theme-card__preview" aria-hidden="true">
            <span className="theme-card__rail"><i /><i /><i /></span>
            <span className="theme-card__canvas"><i /><i /><b /></span>
          </span>
          <span className="theme-card__label">{theme.label}<span className="theme-card__check"><CheckIcon size={13} /></span></span>
        </button>
      ))}
    </div>
  )
}
