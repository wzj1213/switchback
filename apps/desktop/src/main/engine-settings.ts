import type { Attached } from "./host.js"
import type { Logger } from "./log.js"
import { installSettingsChannel, type Store } from "./settings.js"

/**
 * 改到「哪几家算接入」的那些偏好之后，让宿主把同一份新清单推给桌面与远程端。
 *
 * 两个字段都要认：`dsh` 管「它那边配好了没有」，`disabledEngines` 管「我要不要用这家」。
 * 只认其中一个的话，另一个改完之后引擎选择器要等到下次重启才收敛——
 * 而那期间界面上摆着一家用户刚关掉的引擎。
 */
const ACCESS_KEYS = ["dsh", "disabledEngines"] as const

export function installEngineSettings(store: Store, attached: Attached, log: Logger): void {
  installSettingsChannel(store, (_before, _after, patch) => {
    if (!ACCESS_KEYS.some((key) => Object.hasOwn(patch, key))) return
    void attached.refreshEngines().catch((error: unknown) => {
      log.write("warn", "engines", `刷新引擎接入状态失败：${String(error)}`)
    })
  })
}
