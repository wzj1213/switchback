import { writeFile } from "node:fs/promises"
import { nativeTheme, type BrowserWindow } from "electron"
import type { Trust } from "@omni/protocol"
import { quitNow } from "./quit.js"

/**
 * 开发期用的自动化钩子，**全部由环境变量开关，默认完全不生效**。
 *
 * | 变量 | 作用 |
 * | --- | --- |
 * | `OMNI_DEV_PROMPT` | 默认会话建好后自动发这条提示词 |
 * | `OMNI_DEV_CWD` | 默认会话开在哪个目录，默认 `process.cwd()` |
 * | `OMNI_DEV_ENGINE` | 默认会话用哪个引擎，默认 `claude` |
 * | `OMNI_DEV_TRUST` | 默认会话的信任档，默认 `auto-edit` |
 * | `OMNI_DEV_MODEL` | `<模型>[:<强度>]`，默认会话用这个模型跑 |
 * | `OMNI_DEV_RESUME` | 置 1 时不新建会话，而是续跑磁盘上最近的那个 |
 * | `OMNI_DEV_FIND` | 到点自动打开查找条并填入这段文字 |
 * | `OMNI_DEV_INTERRUPT` | 过这么多毫秒之后自动中断当前轮次 |
 * | `OMNI_DEV_RELOAD` | 过这么多毫秒之后强制重载渲染层（验证全量重建） |
 * | `OMNI_DEV_COMPARE` | 过这么多毫秒之后打开分叉对比视图 |
 * | `OMNI_DEV_REVIEW` | 过这么多毫秒之后打开审核面板 |
 * | `OMNI_DEV_FILTER` | 截图前把焦点送进侧栏筛选框并打这段字 |
 * | `OMNI_DEV_SELECT` | 截图前点开输入区里第 N 个下拉（1 起） |
 * | `OMNI_DEV_SETTINGS` | 截图前打开设置，并切到左列第 N 页（1 起） |
 * | `OMNI_DEV_ROWMENU` | 截图前在侧栏第 N 行上右键（1 起） |
 * | `OMNI_DEV_THEME` | `dark` / `light`，强制主题（深色那套平时没人看得见） |
 * | `OMNI_DEV_HANDOFF` | `<ms>:<引擎>`，到点把会话**接力**给这家 |
 * | `OMNI_DEV_FORK` | `<ms>:<引擎>`，到点**分叉**一份给这家（原会话保留） |
 * | `OMNI_DEV_MAXLIVE` | 同时活着的引擎会话上限（默认 4）。设很大等于关掉淘汰 |
 * | `OMNI_DEV_RENAME` | `<ms>:<新名字>`，到点给当前会话改名 |
 * | `OMNI_DEV_DELETE` | 到点删掉当前会话（毫秒） |
 * | `OMNI_DEV_SHOT` | 到点把窗口截成 PNG 写到这个路径，然后退出 |
 * | `OMNI_DEV_SHOT_DELAY` | 截图前等多少毫秒，默认 45000 |
 *
 * 用 `webContents.capturePage()` 而不是系统级截屏：只拍这个窗口，
 * 不需要录屏权限，也不会把桌面上的其他东西一起拍进去。
 */
export function devPrompt(): string | undefined {
  const text = process.env["OMNI_DEV_PROMPT"]
  return text === undefined || text === "" ? undefined : text
}

/**
 * 默认会话开在哪个目录。
 *
 * 不给就用 `process.cwd()`——但在 `pnpm dev` 下那是 `apps/desktop`，
 * 不是你以为的那个目录。验证时对着一个空目录跑，agent 会老老实实回答
 * 「这里没有那个文件」，看起来像驱动坏了，其实是工作区搞错了。踩过一次。
 */
export function devCwd(fallback: string): string {
  const dir = process.env["OMNI_DEV_CWD"]
  return dir === undefined || dir === "" ? fallback : dir
}

/**
 * 开机自动建的那个会话，工作区开在哪。
 *
 * ## 为什么不能用 `process.cwd()`
 *
 * 在 `pnpm dev` 里它是仓库根目录，看着挺合理。**而从 Dock 启动的打包应用，
 * 它是 `/`。** 于是「自动审批」档承诺的「工作区内直接放行、越界才问」变成了
 * 「整个文件系统都算工作区内」——所有依赖工作区边界的红线一条都不会命中。
 *
 * 这不是理论：`isInside("/", 任何绝对路径)` 恒为真。
 *
 * ## 那开在哪
 *
 * 用户的家目录。它是个真实存在、有边界的地方，而且**大多数人的代码都在里面**，
 * 所以第一句话就能用。不选 `~/Documents` 之类是因为那更像在替用户做决定。
 *
 * 更根本的解法是「首次启动先让用户选一个文件夹」，那是产品决定，
 * 单开一件事做；在那之前，至少不能把边界设成整个磁盘。
 */
export function defaultWorksite(home: string): string {
  const dir = process.env["OMNI_DEV_CWD"]
  if (dir !== undefined && dir !== "") return dir
  const cwd = process.cwd()
  // 根目录、或者任何不在 home 底下的诡异 cwd（Dock 启动就是 `/`），都退回 home
  return cwd === "/" || !cwd.startsWith(home) ? home : cwd
}

/** 换引擎跑一遍是验证归一化模型的主要手段，所以给它留了个口子。 */
export function devEngine(): string {
  const engine = process.env["OMNI_DEV_ENGINE"]
  return engine === undefined || engine === "" ? "claude" : engine
}

const TRUSTS = new Set<Trust>(["read-only", "auto-edit", "full"])

/** 验证运行态时常常需要一个不会被审批打断的档位，所以也留个口子。认不出就用默认。 */
export function devTrust(): Trust {
  const value = process.env["OMNI_DEV_TRUST"]
  return value !== undefined && TRUSTS.has(value as Trust) ? (value as Trust) : "auto-edit"
}

/**
 * 默认会话用哪个模型跑。
 *
 * 加这个口子是被逼的：验证任何「引擎真的做了什么」的事都要跑一轮真的，
 * 而账号主额度用满时**每一轮都失败**，验证就整个停摆。
 * 换一个还有配额的模型就能继续。
 *
 * 顺带也验了换模型这条路本身。格式 `<模型>[:<强度>]`——强度要能一起给，
 * 因为**不是每个模型都支持每一档**：实测把 `max` 发给 spark 直接整轮失败
 *（`Unsupported value: 'max' is not supported with the ... model`）。
 */
export function devModel(): { model: string; effort?: string } | undefined {
  const spec = process.env["OMNI_DEV_MODEL"]
  if (spec === undefined || spec === "") return undefined
  const [model, effort] = spec.split(":")
  if (model === undefined || model === "") return undefined
  return { model, ...(effort === undefined || effort === "" ? {} : { effort }) }
}

/**
 * 同时活着的引擎会话上限。
 *
 * 留这个口子有两个用处：**A/B 量淘汰到底省了多少**（设成很大就等于关掉它），
 * 以及内存大的机器可以自己往上调。认不出就用宿主的缺省。
 */
export function devMaxLive(): number | undefined {
  const raw = Number(process.env["OMNI_DEV_MAXLIVE"] ?? "")
  return Number.isFinite(raw) && raw >= 1 ? raw : undefined
}

/** 续跑只能靠点按钮触发，自动化验证需要一个口子。 */
export function devResume(): boolean {
  return process.env["OMNI_DEV_RESUME"] === "1"
}

/**
 * 到点自动打开查找条。查找要按 ⌘F 才出得来，自动化截图按不了键。
 *
 * 走的是**和菜单同一条**通道，所以验证的是真链路，不是一条测试专用的旁路。
 */
export function scheduleDevFind(win: BrowserWindow): void {
  const query = process.env["OMNI_DEV_FIND"]
  if (query === undefined || query === "") return
  const delay = Number(process.env["OMNI_DEV_SHOT_DELAY"] ?? "45000") - 2500
  setTimeout(() => {
    if (!win.isDestroyed()) win.webContents.send("omni:menu", "find")
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.send("omni:devFind", query)
    }, 300)
  }, Math.max(0, delay))
}

/** 到点自动中断。中断只能靠点按钮或按快捷键触发，自动化验证需要一个口子。 */
export function scheduleDevInterrupt(win: BrowserWindow): void {
  const at = Number(process.env["OMNI_DEV_INTERRUPT"] ?? "0")
  if (!Number.isFinite(at) || at <= 0) return
  setTimeout(() => {
    if (!win.isDestroyed()) win.webContents.send("omni:menu", "interrupt")
  }, at)
}

/**
 * 到点强制重载渲染层。
 *
 * 这是验证事件流序号与全量重建的**唯一**自动化手段：重载会把渲染层的状态
 * 清空，只有主进程那份全量重建靠得住，界面才能恢复原样。
 * 手工按 ⌘R 也能复现，但复现不了「重载期间引擎还在产出事件」那一段。
 */
export function scheduleDevReload(win: BrowserWindow): void {
  const at = Number(process.env["OMNI_DEV_RELOAD"] ?? "0")
  if (!Number.isFinite(at) || at <= 0) return
  setTimeout(() => {
    if (!win.isDestroyed()) win.webContents.reload()
  }, at)
}

/**
 * 到点把焦点送进侧栏筛选框并打一段字。
 *
 * 用 `insertText` 而不是模拟按键：它插进**当前获得焦点的可编辑元素**，
 * 所以这一条同时验了两件事——⌘K 有没有把焦点送对地方、筛选有没有生效。
 * 焦点没落在筛选框上的话，字会一个都进不去（或者跑进输入框里），一眼看得出来。
 */
export function scheduleDevFilter(win: BrowserWindow): void {
  const text = process.env["OMNI_DEV_FILTER"]
  if (text === undefined || text === "") return
  const delay = Number(process.env["OMNI_DEV_SHOT_DELAY"] ?? "45000") - 3000
  setTimeout(() => {
    if (win.isDestroyed()) return
    win.webContents.send("omni:menu", "filter-threads")
    setTimeout(() => {
      if (!win.isDestroyed()) win.webContents.insertText(text)
    }, 400)
  }, Math.max(0, delay))
}

/**
 * 到点点开输入区里第 N 个下拉。
 *
 * 自绘浮层能截到图，原生 `<select>` 的弹出层截不到——**这本身就是换掉它的
 * 理由之一**。有了这个钩子，下拉长什么样才进得了自动化验证。
 */
export function scheduleDevOpenSelect(win: BrowserWindow): void {
  const nth = Number(process.env["OMNI_DEV_SELECT"] ?? "0")
  if (!Number.isFinite(nth) || nth <= 0) return
  const delay = Number(process.env["OMNI_DEV_SHOT_DELAY"] ?? "45000") - 2000
  setTimeout(() => {
    if (win.isDestroyed()) return
    void win.webContents.executeJavaScript(
      `document.querySelectorAll(".composer__bar .trigger")[${String(nth - 1)}]?.click()`,
    )
  }, Math.max(0, delay))
}

/**
 * 截图前把设置面板打开，并切到左列第 N 页。
 *
 * **和 `OMNI_DEV_SELECT` 同一条理由**：这块面板有七页，每一页的内容都要等异步
 * （探版本、读配置、扫 journal），靠手点去验等于永远不验。分两拍是必须的——
 * 面板是模态，第一拍还没挂出来，左列那几颗按钮在 DOM 里根本不存在。
 */
export function scheduleDevSettings(win: BrowserWindow): void {
  const nth = Number(process.env["OMNI_DEV_SETTINGS"] ?? "0")
  if (!Number.isFinite(nth) || nth <= 0) return
  const delay = Number(process.env["OMNI_DEV_SHOT_DELAY"] ?? "45000") - 3000
  setTimeout(() => {
    if (win.isDestroyed()) return
    win.webContents.send("omni:menu", "settings")
    setTimeout(() => {
      if (win.isDestroyed()) return
      void win.webContents.executeJavaScript(
        `document.querySelectorAll(".set__nav .set__tab")[${String(nth - 1)}]?.click()`,
      )
    }, 400)
  }, Math.max(0, delay))
}

/**
 * 强制深浅色。深色那套 token 平时没人看得见，改动 CSS 之后**必须能验一眼**——
 * 靠改系统设置去验，等于永远不验。
 */
export function applyDevTheme(): void {
  const want = process.env["OMNI_DEV_THEME"]
  if (want !== "dark" && want !== "light") return
  nativeTheme.themeSource = want
}

/** 到点在渲染层跑一段 JS，把结果打进日志。排查用，平时不开。 */
export function scheduleDevProbe(win: BrowserWindow, log: (message: string) => void): void {
  const code = process.env["OMNI_DEV_PROBE"]
  if (code === undefined || code === "") return
  // **自己的时刻**，不跟截图那个。跟着截图的话探针总是只剩 3 秒可用，
  // 而要观察流式这种持续过程，得从早跑到晚
  const delay = Number(process.env["OMNI_DEV_PROBE_AT"] ?? "4000")
  setTimeout(() => {
    if (win.isDestroyed()) return
    void win.webContents
      .executeJavaScript(code)
      .then((value: unknown) => {
        log(`probe: ${JSON.stringify(value)}`)
      })
      .catch((error: unknown) => {
        log(`probe 失败：${String(error)}`)
      })
  }, Math.max(0, delay))
}

/**
 * 到点在侧栏第 N 行上右键。
 *
 * 和 `OMNI_DEV_SELECT` 一个道理：菜单是浮层，不点开就进不了截图。
 */
export function scheduleDevRowMenu(win: BrowserWindow): void {
  const nth = Number(process.env["OMNI_DEV_ROWMENU"] ?? "0")
  if (!Number.isFinite(nth) || nth <= 0) return
  const delay = Number(process.env["OMNI_DEV_SHOT_DELAY"] ?? "45000") - 2000
  setTimeout(() => {
    if (win.isDestroyed()) return
    void win.webContents.executeJavaScript(
      `(() => {
        const row = document.querySelectorAll(".sidebar__list .row")[${String(nth - 1)}]
        if (!row) return
        const box = row.getBoundingClientRect()
        row.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true, clientX: box.left + 60, clientY: box.top + 12,
        }))
      })()`,
    )
  }, Math.max(0, delay))
}

/** 到点打开对比视图。和查找、中断一样，走的是**菜单同一条通道**，验的是真链路。 */
export function scheduleDevCompare(win: BrowserWindow): void {
  const at = Number(process.env["OMNI_DEV_COMPARE"] ?? "0")
  if (!Number.isFinite(at) || at <= 0) return
  setTimeout(() => {
    if (!win.isDestroyed()) win.webContents.send("omni:menu", "compare")
  }, at)
}

/** 到点打开审核面板。同上，走菜单那条通道——验的是「⇧⌘R 真的能开出来」。 */
export function scheduleDevReview(win: BrowserWindow): void {
  const at = Number(process.env["OMNI_DEV_REVIEW"] ?? "0")
  if (!Number.isFinite(at) || at <= 0) return
  setTimeout(() => {
    if (!win.isDestroyed()) win.webContents.send("omni:menu", "review")
  }, at)
}

/** 到点自动接力或分叉。这两个动作只能靠点界面触发，自动化验证需要一个口子。 */
export function scheduleDevSwitch(
  win: BrowserWindow,
  run: (kind: "handoff" | "fork", to: string) => void,
): void {
  for (const [key, kind] of [
    ["OMNI_DEV_HANDOFF", "handoff"],
    ["OMNI_DEV_FORK", "fork"],
  ] as const) {
    const spec = process.env[key]
    if (spec === undefined || spec === "") continue
    const [msText, to] = spec.split(":")
    const at = Number(msText)
    if (!Number.isFinite(at) || to === undefined || to === "") continue
    setTimeout(() => {
      if (!win.isDestroyed()) run(kind, to)
    }, at)
  }
}

/**
 * 到点给当前会话改名 / 删掉它。
 *
 * 加这两个口子是因为它们**只能靠界面触发**（改名要双击标题，删除在行内菜单里
 * 还带二次确认），而它们现在有了引擎侧的副作用要验：改名要传给
 * `thread/name/set`，删除要先 `thread/archive` 再 dispose。
 * 验不了的副作用等于没做。
 */
export function scheduleDevThreadOps(
  win: BrowserWindow,
  run: (op: { kind: "rename"; title: string } | { kind: "delete" }) => void,
): void {
  const rename = process.env["OMNI_DEV_RENAME"]
  if (rename !== undefined && rename !== "") {
    // 名字里可能有冒号，所以只按**第一个**冒号切
    const cut = rename.indexOf(":")
    const at = Number(rename.slice(0, cut))
    const title = rename.slice(cut + 1)
    if (Number.isFinite(at) && title !== "") {
      setTimeout(() => {
        if (!win.isDestroyed()) run({ kind: "rename", title })
      }, at)
    }
  }
  const del = Number(process.env["OMNI_DEV_DELETE"] ?? "0")
  if (Number.isFinite(del) && del > 0) {
    setTimeout(() => {
      if (!win.isDestroyed()) run({ kind: "delete" })
    }, del)
  }
}

export function scheduleDevShot(win: BrowserWindow): void {
  const target = process.env["OMNI_DEV_SHOT"]
  if (target === undefined || target === "") return
  const delay = Number(process.env["OMNI_DEV_SHOT_DELAY"] ?? "45000")
  setTimeout(() => {
    void win.webContents
      .capturePage()
      .then((image) => writeFile(target, image.toPNG()))
      .then(() => {
        quitNow()
      })
      .catch((error: unknown) => {
        console.error("dev shot failed:", error)
        quitNow()
      })
  }, delay)
}
