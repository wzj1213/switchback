import { execFile, spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { app, ipcMain } from "electron"
import type { Logger } from "./log.js"
import { quitNow } from "./quit.js"
import { readBuildInfo } from "./build-info.js"

/**
 * 从**本机源码**把自己重装一遍。
 *
 * ## 为什么需要这个东西
 *
 * Switchback 是从这台机器上的 checkout 打出来的（`pnpm dist`），装在
 * `/Applications/Switchback.app`。于是每改一行代码，「让它生效」意味着：切到终端、
 * 跑一遍打包、等 208 MB 的 DMG、挂载、把 .app 拖进 /Applications、覆盖、重开。
 * 一天十几次——**这段路本身就劝退了「改一点就试一下」这种最该鼓励的用法**。
 *
 * 远端那套（`update.ts`）回答的是另一个问题：装在别人机器上的包怎么知道有新版。
 * 两者不冲突，也不该互相冒充——**这个文件里一行网络请求都没有**。
 *
 * ## 边界：只在「这台机器上有源码」时存在
 *
 * 源码路径是打包时烤进去的（`scripts/dist.mjs` 的临时元数据写 `switchback.repo`）。
 * 把这个包拷到别人机器上，那个路径不存在，入口整个不出现——**不是灰掉，是不画**。
 * 一个在别人机器上永远点不动的按钮只是噪声。
 *
 * ## 判据是「有没有源码比这份包新」，不是版本号
 *
 * 版本号来自 git 提交数，而开发时改动大多**还没提交**——按版本号比，
 * 改完代码它会说「已经是最新」。所以直接问文件系统：
 * 有没有任何一个源码文件比装着的这份包新（`find -newer`）。
 * 这个判据对「改了没提交」和「提交了没重装」同样成立，而且更新完自己就安静了。
 */

export interface SelfUpdate {
  /** 这台机器上能不能一键更新。false 时界面什么都不画。 */
  can: boolean
  /** 不能的原因。写日志，不摆到界面上——那是给我们排查用的。 */
  why?: string
  /** 有没有比装着的这份更新的源码。 */
  stale: boolean
  /** 谁比它新（相对路径）。摆进按钮的 title：让人看得见它凭什么说「有新代码」。 */
  newest?: string
  /** 装着的这份是从哪次提交打出来的。 */
  built?: string
}

export interface SelfUpdateRun {
  ok: boolean
  /** 构建输出。失败时全靠它排查，所以原样带回来。 */
  output: string
}

/** 应用包的根（`/Applications/Switchback.app`）。不是从 .app 里跑的就返回 undefined。 */
export function bundleOf(execPath: string): string | undefined {
  const at = execPath.indexOf(".app/Contents/MacOS/")
  return at === -1 ? undefined : execPath.slice(0, at + ".app".length)
}

/**
 * 换包脚本。**必须是一个独立进程**：它要做的第一件事就是等自己的父进程死掉。
 *
 * 三条都是有理由的：
 *
 * - **等旧进程退出再动手**：macOS 上覆盖一个正在跑的 .app，运行中的那份会
 *   在下一次读资源时崩掉。等它走完再换，是 Sparkle 那类更新器的标准做法。
 * - **在同一个目录里 mv，不是原地覆盖**：同盘 `mv` 是原子的，中途断电也不会
 *   留下一个换了一半的应用。先 `ditto` 到旁边、再两次 `mv`。
 * - **换新的失败就把旧的挪回来**。一次失败的更新可以接受，
 *   「更新完发现应用没了」不行。
 */
export function swapScript(o: { pid: number; from: string; to: string; log: string }): string {
  const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
  const stage = `${o.to}.更新中`
  const backup = `${o.to}.上一版`
  return [
    "#!/bin/sh",
    `exec >> ${q(o.log)} 2>&1`,
    `echo "=== 换包：${o.from} → ${o.to}"`,
    "n=0",
    `while kill -0 ${String(o.pid)} 2>/dev/null; do`,
    "  sleep 0.2",
    "  n=$((n+1))",
    '  if [ "$n" -gt 300 ]; then echo "旧进程 60 秒还没退出，放弃"; exit 1; fi',
    "done",
    `rm -rf ${q(stage)} ${q(backup)}`,
    `/usr/bin/ditto ${q(o.from)} ${q(stage)} || { echo "拷贝新包失败"; exit 1; }`,
    `mv ${q(o.to)} ${q(backup)} || { echo "挪开旧包失败"; exit 1; }`,
    `mv ${q(stage)} ${q(o.to)} || { mv ${q(backup)} ${q(o.to)}; echo "装新包失败，已还原"; exit 1; }`,
    `rm -rf ${q(backup)}`,
    `open ${q(o.to)}`,
    'echo "换完了"',
    "",
  ].join("\n")
}

/**
 * 有没有源码比这份包新。返回那个文件（相对路径），没有就是 undefined。
 *
 * 用 `find -newer … -print -quit`：**找到第一个就停**，不遍历整棵树。
 * 剪掉的四类是构建产物和依赖（`node_modules` / `.git` / `release` / `out` / `dist`）——
 * 不剪的话它们必然比包新，判据就恒为「有新代码」，等于没判。
 */
async function newerThan(repo: string, stamp: string): Promise<string | undefined> {
  const prune = ["node_modules", ".git", "release", "out", "dist"].flatMap((name) => [
    "-name",
    name,
    "-prune",
    "-o",
  ])
  const out = await run(
    "/usr/bin/find",
    [repo, ...prune, "-newer", stamp, "-type", "f", "-print", "-quit"],
    repo,
    20_000,
  )
  const first = out.output.split("\n").find((line) => line.trim() !== "")
  return first === undefined ? undefined : relative(repo, first.trim())
}

/** 现在是什么情况。**界面和更新动作读的是同一份判断**，不各算各的。 */
export async function statusOf(): Promise<SelfUpdate> {
  const { repo, build } = readBuildInfo(app.getAppPath())
  const bundle = bundleOf(process.execPath)
  const built = build === undefined ? {} : { built: build }
  if (!app.isPackaged || bundle === undefined) {
    return {
      can: false,
      why: "不是从 .app 跑的（开发模式下改完存盘就生效，用不着这个）",
      stale: false,
      ...built,
    }
  }
  if (repo === undefined || !existsSync(repo)) {
    return {
      can: false,
      why: `这个包烤进去的源码路径不在这台机器上：${repo ?? "（没烤）"}`,
      stale: false,
      ...built,
    }
  }
  const stamp = join(bundle, "Contents/Resources/app.asar")
  if (!existsSync(stamp)) return { can: false, why: `找不到 ${stamp}`, stale: false, ...built }
  const newest = await newerThan(repo, stamp)
  return {
    can: true,
    stale: newest !== undefined,
    ...(newest === undefined ? {} : { newest }),
    ...built,
  }
}

/**
 * 构建 + 换包 + 重开。
 *
 * 构建跑的是 `pnpm dist:local`——**和界面上说的那条命令逐字相同**
 *（`enginever.ts` 立的规矩：按钮背后不藏一条你没看过的命令）。
 * 它只出 .app 不打 DMG：那 208 MB 是给别人装的，自己换一份包用不着。
 *
 * 换包不在这个进程里做：它要等这个进程死掉才能动手（见 `swapScript`）。
 */
async function runUpdate(log: Logger): Promise<SelfUpdateRun> {
  const state = await statusOf()
  const { repo } = readBuildInfo(app.getAppPath())
  const bundle = bundleOf(process.execPath)
  if (!state.can || repo === undefined || bundle === undefined) {
    return { ok: false, output: state.why ?? "这台机器上不能自更新" }
  }
  log.write("info", "update", `开始从源码重建：${repo}`)
  // 给足时间：electron-builder 打一次 mac 包实测一两分钟，机器忙的时候更久
  const built = await run("pnpm", ["run", "dist:local"], join(repo, "apps/desktop"), 15 * 60_000)
  if (!built.ok) {
    log.write("error", "update", `构建失败：${built.output.slice(-400)}`)
    return { ok: false, output: built.output }
  }
  const fresh = freshBundleOf(repo)
  if (!existsSync(fresh)) {
    log.write("error", "update", `构建跑完了，但没找到 ${fresh}`)
    return { ok: false, output: `${built.output}\n\n构建跑完了，但没找到 ${fresh}` }
  }
  handoff(log, fresh, bundle)
  return { ok: true, output: built.output }
}

/**
 * 刚构建出来的那个包在哪。**包名读仓库里当前的 `productName`**，不用这个进程编译进去的那个：
 * 产品改过一次名（omni → Switchback），旧版本按旧名去找，构建明明成功了却一直报「没找到」，
 * 按钮就卡在「构建失败，再试一次」。读仓库里的，下次再改名也找得到。
 */
export function freshBundleOf(repo: string): string {
  let name = "Switchback"
  try {
    const pkg = JSON.parse(readFileSync(join(repo, "apps/desktop/package.json"), "utf8")) as { productName?: unknown }
    if (typeof pkg.productName === "string" && pkg.productName !== "") name = pkg.productName
  } catch {
    // 读不到就按默认名找；真找不到，下面会把路径写进日志
  }
  return join(repo, "release/mac-arm64", `${name}.app`)
}

/** 把换包这件事交给一个独立进程，然后正常退出。 */
function handoff(log: Logger, from: string, to: string): void {
  const dir = mkdtempSync(join(tmpdir(), "switchback-update-"))
  const file = join(dir, "swap.sh")
  const logFile = join(app.getPath("userData"), "自更新.log")
  writeFileSync(file, swapScript({ pid: process.pid, from, to, log: logFile }), { mode: 0o755 })
  const child = spawn("/bin/sh", [file], { detached: true, stdio: "ignore" })
  child.unref()
  log.write("info", "update", `构建好了，交给换包脚本：${file}（日志 ${logFile}）`)
  // 等一下再退：这条命令的回包还要发回渲染层，让它把按钮切成「正在重启」
  setTimeout(() => {
    // 走 `quitNow`：换包脚本已经在外面等着这个进程消失了，
    // 这时候弹一个「还有活在跑，确定退出吗」只会把它卡在那儿等一个永远不来的点击
    quitNow()
  }, 300)
}

export function installSelfUpdateChannel(log: Logger): void {
  ipcMain.handle("switchback:selfUpdateStatus", async (): Promise<SelfUpdate> => {
    const state = await statusOf()
    if (!state.can && state.why !== undefined)
      log.write("info", "update", `自更新不可用：${state.why}`)
    return state
  })
  ipcMain.handle("switchback:selfUpdate", () => runUpdate(log))
}

/** 跑一条命令，把输出（含 stderr）原样带回来。**失败不抛**——调用方要那段原文。 */
function run(
  cmd: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<SelfUpdateRun> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      [...args],
      { cwd, timeout: timeoutMs, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout}${stderr}`
        resolve({
          ok: error === null,
          output: error === null ? output : `${output}\n${String(error)}`,
        })
      },
    )
  })
}
