import type { SwitchbackBridge } from "../../preload/index.js"
import type { PickedFiles } from "../../shared/attachments.js"
import type { Connection } from "./connection.js"
import { documentLocale } from "../i18n.js"
import { REMOTE_LOCAL } from "./bridge-local.messages.js"

/**
 * 远程窗口的桥里，**不走宿主通道**的那两类（`bridge.ts` 的另一半）。
 *
 * - `local`：在**这台**电脑上就能做的——剪贴板、挑图片上传、问一个宿主上的目录。
 * - `hostOnly`：只在宿主屏幕上有意义的——弹宿主的框、在宿主的访达里定位、用宿主的编辑器打开、
 *   装引擎、自更新、管远程访问。**绝不在宿主上真的做**（那件事会发生在另一台机器的屏幕上，
 *   这头的人看不见）。
 *
 * ## 「在访达中显示」这类按钮不藏，改成复制路径
 *
 * 它们散在十几个组件里（转录区、审核面板、时间线、设置…）。逐个去藏，是在两种窗口共用的
 * 那棵树上到处加分支；而什么都不做又是一颗「点了没反应」的按钮。所以远程窗口里它们做一件
 * **这头真用得上的事**：把宿主上的那条路径复制下来，并说一句「它在那台机器上」。
 * 要回值的（装引擎、自更新、管设备）照旧明确失败——那几页在远程窗口里本来就不摆（`SettingsPanel`）。
 */
type Bridge = SwitchbackBridge

// 这些话是点下去那一刻才说的，语言从 `<html lang>` 现读（远程窗口的桥在 React 外面）
const say = (): (typeof REMOTE_LOCAL)["zh-CN"] => REMOTE_LOCAL[documentLocale()]
const refuse = (): Promise<never> => Promise.reject(new Error(say().onlyThere))
const nothing = (): void => undefined
const unsubscribe = (): (() => void) => nothing

/** 复制宿主上的一条路径，并说清它在哪。 */
function pointAt(conn: Connection, path: string, what: string): void {
  void navigator.clipboard.writeText(path).then(
    () => {
      conn.say(say().copied(what, path))
    },
    () => {
      conn.say(say().located(what, path))
    },
  )
}

export function hostOnly(conn: Connection) {
  return {
    installEngine: refuse,
    updateEngine: refuse,
    tryAcpEngine: refuse,
    addAcpEngine: refuse,
    rescanEngines: refuse,
    pickExecutable: () => Promise.resolve(undefined),
    openEngineFile: (path) => {
      pointAt(conn, path, say().config)
    },
    openEnvFile: (path) => {
      pointAt(conn, path, say().config)
    },
    openProjectDoc: (_threadId, cwd) => {
      pointAt(conn, `${cwd}/AGENTS.md`, say().doc)
    },
    openEngines: () => {
      conn.say(say().engines)
    },
    diagnose: () => {
      conn.say(say().diagnose)
    },
    reveal: (path) => {
      pointAt(conn, path, say().file)
    },
    // 「能不能一键更新」：远程窗口里那颗按钮不画（`can: false` 时界面什么都不画）
    selfUpdateStatus: () => Promise.resolve({ can: false, why: say().remoteWindow, stale: false }),
    selfUpdate: refuse,
    acpRegistry: refuse,
    acpConnect: refuse,
    acpEngines: refuse,
    acpEngineTry: refuse,
    acpLogin: refuse,
    acpLogout: refuse,
    acpEngineRemove: refuse,
    acpCancel: nothing,
    onAcpProgress: unsubscribe,
    onDevFind: unsubscribe,
    remote: { status: refuse, sync: refuse, pair: refuse, revoke: refuse, setDeviceTrust: refuse },
  } satisfies Partial<Bridge>
}

/** 在这台电脑上挑几张图。用户取消时（`cancel` 事件）回 undefined。 */
function chooseImages(): Promise<readonly File[] | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.multiple = true
    input.accept = "image/*"
    input.addEventListener("change", () => {
      resolve([...(input.files ?? [])])
    }, { once: true })
    input.addEventListener("cancel", () => {
      resolve(undefined)
    }, { once: true })
    input.click()
  })
}

/**
 * 「附件」那颗按钮。宿主的文件选择器弹在宿主屏幕上；这里改成**挑这台电脑上的图、传过去**——
 * 和贴图走的是同一条 `stashImage`。只收图：别的文件传过去也只能当一条路径引用，
 * 而那条路径在宿主上不存在。
 */
async function pickImages(conn: Connection): Promise<PickedFiles> {
  const files = await chooseImages()
  if (files === undefined || files.length === 0) return { files: [], failed: 0, canceled: true }
  const picked: { path: string; image: boolean }[] = []
  let failed = 0
  for (const file of files) {
    const bytes = await file.arrayBuffer()
    const path = await conn.call("switchback:stashImage", { mime: file.type, bytes }).catch(() => undefined)
    if (typeof path === "string") picked.push({ path, image: true })
    else failed += 1
  }
  return { files: picked, failed, canceled: false }
}

export function local(conn: Connection, host: string) {
  return {
    copy: async (text) => {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        return false
      }
    },
    // 页内查找交给浏览器自己的 ⌘F
    find: () => Promise.resolve({ active: 0, total: 0 }),
    stopFind: nothing,
    // 菜单是 Electron 的；浏览器里没有那一排菜单，快捷键归浏览器
    onMenu: unsubscribe,
    // 拖进来的文件在这台电脑上，宿主上没有这条路径
    pathForFile: () => "",
    pickFolder: () => {
      const typed = window.prompt(say().folder(host))
      const path = typed?.trim() ?? ""
      return Promise.resolve(path === "" ? undefined : path)
    },
    pickFiles: () => pickImages(conn),
    // 随文件变化刷新要宿主往这边推，第一版没做（见 `docs/远程模式方案.md` §7）
    watchFile: () => nothing,
  } satisfies Partial<Bridge>
}
