import { ipcMain } from "electron"
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
    void attached.refreshEngines("dsh").catch((error: unknown) => {
      log.write("warn", "engines", `刷新引擎接入状态失败：${String(error)}`)
    })
  })
  /**
   * 手点「重新探测」。
   *
   * **在此之前，探测一辈子只跑一次。** `engine-catalog` 的缓存挂在进程上，
   * 除了 DSH 改 profile 没有任何东西让它失效——于是「我在终端里装好了」
   * 这件最普通的事，界面上唯一的出路是重启 omni（codex 的安装提示原话就是
   * 「装好之后重启 omni」）。
   *
   * 不做成自动轮询：探测要 spawn 一串 `--version` 子进程，为一件一年发生几次的事
   * 常驻一个定时器不划算。**一颗按钮就够**——用户知道自己刚装完了什么。
   */
  ipcMain.handle("omni:rescanEngines", async () => {
    // **前后各读一次，diff 在这里算。** 放渲染层算的话要和事件流里那份异步的
    // `engines.available` 赛跑——而这里手上就有确定的前后两份
    const before = new Map((await attached.engines()).map((one) => [one.id, one.state ?? "unknown"]))
    const report = await attached.refreshEngines()
    const changed = (await attached.engines())
      .filter((one) => (one.state ?? "unknown") !== (before.get(one.id) ?? "unknown"))
      .map((one) => ({ id: one.id, label: one.label, ...(one.state === undefined ? {} : { state: one.state }) }))
    return { changed, needsRestart: report.needsRestart }
  })
}
