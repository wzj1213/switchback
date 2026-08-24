import type { Attached } from "./host.js"
import type { Logger } from "./log.js"
import { installSettingsChannel, type Store } from "./settings.js"

/** DSH 接入确认变更后，让宿主把同一份新清单推给桌面与远程端。 */
export function installEngineSettings(store: Store, attached: Attached, log: Logger): void {
  installSettingsChannel(store, (_before, _after, patch) => {
    if (!Object.hasOwn(patch, "dsh")) return
    void attached.refreshEngines().catch((error: unknown) => {
      log.write("warn", "engines", `刷新 DSH 接入状态失败：${String(error)}`)
    })
  })
}
