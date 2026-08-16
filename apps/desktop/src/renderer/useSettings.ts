import { useCallback, useEffect, useState } from "react"
import { SETTINGS_DEFAULTS, type Settings } from "../shared/settings.js"

/**
 * 偏好。真源在主进程（`main/settings.ts`），这里只做**读一次 + 写回去**。
 *
 * 没有做本地乐观更新：偏好的改动一秒钟发生不了几次，
 * 而乐观更新要处理「写失败了怎么回滚」，代价换不来任何东西。
 */
const FALLBACK: Settings = SETTINGS_DEFAULTS

export interface SettingsApi {
  settings: Settings
  patch: (next: Partial<Settings>) => void
  /** 置顶/取消置顶一个工作区。 */
  togglePin: (cwd: string) => void
  isPinned: (cwd: string) => boolean
}

export function useSettings(): SettingsApi {
  const [settings, setSettings] = useState<Settings>(FALLBACK)
  const bridge = typeof window === "undefined" ? undefined : window.omni

  useEffect(() => {
    if (bridge === undefined) return
    void bridge.settings().then(setSettings)
  }, [bridge])

  const patch = useCallback(
    (next: Partial<Settings>) => {
      if (bridge === undefined) return
      void bridge.settings(next).then(setSettings)
    },
    [bridge],
  )

  const togglePin = useCallback(
    (cwd: string) => {
      // 置顶追加到**末尾**：用户置顶的先后就是他心里的优先级，
      // 插到前面会让刚置顶的那个把常用的顶下去
      const pinned = settings.pinned.includes(cwd)
        ? settings.pinned.filter((x) => x !== cwd)
        : [...settings.pinned, cwd]
      patch({ pinned })
    },
    [settings.pinned, patch],
  )

  return {
    settings,
    patch,
    togglePin,
    isPinned: (cwd) => settings.pinned.includes(cwd),
  }
}

export type { Settings } from "../shared/settings.js"
