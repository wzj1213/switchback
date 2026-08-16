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
  /** 给项目设图标；空字符串 = 清掉（键一并删掉，不留空值）。 */
  setIcon: (cwd: string, icon: string) => void
  /** 置顶 / 取消置顶一条会话。 */
  pinThread: (id: string, pin: boolean) => void
  /** 存下某个项目内会话的手动顺序（整段）。 */
  setOrder: (cwd: string, ids: readonly string[]) => void
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

  const pinThread = useCallback(
    (id: string, pin: boolean) => {
      // 和置顶项目同一条规矩：追加到**末尾**，先钉的排前面
      const rest = settings.pinnedThreads.filter((x) => x !== id)
      patch({ pinnedThreads: pin ? [...rest, id] : rest })
    },
    [settings.pinnedThreads, patch],
  )

  const setOrder = useCallback(
    (cwd: string, ids: readonly string[]) => {
      patch({ threadOrder: { ...settings.threadOrder, [cwd]: ids } })
    },
    [settings.threadOrder, patch],
  )

  const setIcon = useCallback(
    (cwd: string, icon: string) => {
      // 清掉时**把键去掉**，不是存一个空串：留着空值的话，
      // 偏好文件会随着用过的项目越攒越长，而那些条目一个都不起作用
      const next = Object.fromEntries(
        Object.entries(settings.projectIcons).filter(([key]) => key !== cwd),
      )
      patch({ projectIcons: icon === "" ? next : { ...next, [cwd]: icon } })
    },
    [settings.projectIcons, patch],
  )

  return {
    settings,
    patch,
    togglePin,
    pinThread,
    setOrder,
    setIcon,
    isPinned: (cwd) => settings.pinned.includes(cwd),
  }
}

export type { Settings } from "../shared/settings.js"
