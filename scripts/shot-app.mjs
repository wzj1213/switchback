#!/usr/bin/env node
/**
 * 给桌面端出图。**界面改动的唯一验收方式。**
 *
 * 用法：`node scripts/shot-app.mjs [输出目录] [--dark] [--min|--mid|--wide] [--reduce] [--audit]`
 *
 * ## 为什么不用 `OMNI_DEV_SHOT`
 *
 * 那条路一次只出一张、每张都要重启一次应用（默认还等 45 秒）。
 * 而界面改动要看的是**一整组屏**——侧栏、转录区、空态、设置各一张，
 * 少看一张就会出现「这一屏好了那一屏坏了」而不自知。
 * 走 CDP 可以一次启动连拍多张，顺带还能在拍之前把界面摆成想要的样子。
 *
 * ## 为什么要自带样本
 *
 * 前后对照的前提是两张图除了改动之外一模一样（见 `ui-fixture.mjs`）。
 */
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import axe from "axe-core"
import WebSocket from "ws"
import { mainThread, noRepoThread, stubThread } from "./ui-fixture.mjs"
import { exerciseEffort, openFixture } from "./shot-fixture-actions.mjs"
import { completeFileDrop, dragIntoView } from "./shot-file-drop.mjs"
import { openPetLive } from "./shot-pet-live.mjs"
import { VIEWS } from "./shot-views.mjs"
import { cleanupWorkspaceFiles, prepareWorkspaceFiles } from "./shot-workspace-files.mjs"
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const DESKTOP = join(ROOT, "apps/desktop")
const electron = createRequire(join(DESKTOP, "package.json"))("electron")
const OUT = process.argv[2] ?? join(ROOT, "release", "app-shots")
const DARK = process.argv.includes("--dark"),
  REDUCED = process.argv.includes("--reduce")
/** 巡检时审整套界面；普通出图仍只审场景自己声明的关键状态，避免拖慢每次比稿。 */
const AUDIT_ALL = process.argv.includes("--audit")
/** 桌宠靶场改动：用隔离数据目录真跑一轮 Claude，拍到枪、靶与逐字流。 */
const PET_LIVE = process.argv.includes("--pet-live")
/**
 * 固定窗口尺寸：前后两张图的像素必须能直接叠着比。
 *
 * `--min` 换成**这个应用允许的最小窗口**（`main/index.ts` 的 minWidth/minHeight）。
 * 那一档值得单独拍：布局塌不塌只在那儿看得出来，而平时没人会把窗口拖到那么小。
 */
const MIN = process.argv.includes("--min")
const MID = process.argv.includes("--mid")
const SIZE = process.argv.includes("--wide")
  ? { width: 1404, height: 720 }
  : MID ? { width: 1172, height: 720 } : MIN ? { width: 860, height: 560 } : { width: 1280, height: 860 }
/** 样本的时间戳写死。**不能用 `Date.now()`**——侧栏上那些「3 小时前」会每次都不一样。 */
const AT = 1_787_659_200_000
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function targetOf(port) {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`)
      .then((r) => r.json())
      .catch(() => [])
    const page = list.find((t) => t.type === "page" && typeof t.webSocketDebuggerUrl === "string")
    if (page !== undefined) return page.webSocketDebuggerUrl
    await pause(150)
  }
  throw new Error("Electron 在 25 秒内没有开放 renderer")
}

function createCdp(url) {
  const socket = new WebSocket(url)
  const waiting = new Map()
  let id = 0
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw))
    const pending = waiting.get(message.id)
    if (pending === undefined) return
    waiting.delete(message.id)
    if (message.error === undefined) pending.resolve(message.result)
    else pending.reject(new Error(JSON.stringify(message.error)))
  })
  return {
    ready: new Promise((resolve, reject) => {
      socket.once("open", resolve)
      socket.once("error", reject)
    }),
    // `close()` 要等 Electron 回 WebSocket 握手；真跑引擎后它可能已经在退出，
    // 句柄会把出图脚本永久挂住。CDP 是一次性验收通道，拍完直接终止即可。
    close: () => socket.terminate(),
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        id += 1
        waiting.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      }),
  }
}

async function value(cdp, expression) {
  const reply = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (reply.exceptionDetails !== undefined) {
    const detail = reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text
    throw new Error(detail)
  }
  return reply.result.value
}

async function waitFor(cdp, expression, label) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (await value(cdp, expression)) return
    await pause(120)
  }
  throw new Error(`界面没有就绪（${label}）：${expression}`)
}

async function audit(cdp, label, enabled) {
  if (!enabled) return
  const violations = await value(
    cdp,
    `axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
  }).then(result => result.violations.map(one => ({
    id: one.id,
    nodes: one.nodes.map(node => ({ target: node.target, summary: node.failureSummary })),
  })))`,
  )
  if (violations.length > 0)
    throw new Error(`${label} 有 axe A/AA 违规：${JSON.stringify(violations)}`)
  console.log(`  ✓ ${label} 没有 axe A/AA 违规`)
}

function audits(view) {
  return AUDIT_ALL || view.audit === true
}

function assertReadyTime(view, preparedAt) {
  if (view.readyWithinMs !== undefined && Date.now() - preparedAt > view.readyWithinMs)
    throw new Error(`${view.name} 超过 ${view.readyWithinMs}ms 才就绪`)
}

/**
 * 把指针**真的**移到某个元素上。
 *
 * 悬停态此前一屏都拍不到：场景只会 `evaluate` 一段 JS，而 `:hover` 和
 * React 的 `onMouseEnter` 都只认真实指针事件。用 `element.focus()` 顶替也不行——
 * 窗口没有系统焦点时，Chromium 只挪 `activeElement`，**不派发 focus 事件**
 *（实测：导航条那一格 `document.activeElement` 已经是它，悬停卡却没出来）。
 *
 * 指针停在那儿不收回：这一屏拍的就是「鼠标正停在上面」。
 */
async function hoverOver(cdp, view) {
  if (view.hover === undefined) return
  const at = await value(cdp, `(() => {
    const node = document.querySelector('${view.hover}')
    if (node === null) return null
    const box = node.getBoundingClientRect()
    return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
  })()`)
  if (at === null) throw new Error(`${view.name} 找不到要悬停的 ${view.hover}`)
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y, buttons: 0 })
  await pause(200)
}

async function shoot(cdp, view, workspaceFiles) {
  let heldDrop
  const preparedAt = Date.now()
  await prepareWorkspaceFiles(ROOT, view, workspaceFiles)
  if (view.before !== undefined) {
    await waitFor(cdp, `document.querySelector('${view.before}') !== null`, `${view.name} 前置`)
  }
  if (view.open !== null) {
    if (view.shortcut !== undefined) {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...view.shortcut })
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...view.shortcut })
      await pause(350)
    }
    for (const step of [view.open].flat()) {
      await value(cdp, `(() => { ${step}; return true })()`)
      await pause(350)
    }
    heldDrop = await dragIntoView({ value, pause, waitFor, root: ROOT }, cdp, view)
    await hoverOver(cdp, view)
    await waitFor(cdp, `document.querySelector('${view.ready}') !== null`, view.name)
    assertReadyTime(view, preparedAt)
    if (
      view.absent !== undefined &&
      (await value(cdp, `document.querySelector('${view.absent}') !== null`))
    ) {
      throw new Error(`${view.name} 仍残留不该出现的 ${view.absent}`)
    }
    if (view.assert !== undefined && !(await value(cdp, view.assert))) {
      throw new Error(`${view.name} 没有满足验收表达式：${view.assert}`)
    }
    if (view.dragEffort === true) await exerciseEffort({ value, pause }, cdp)
    await pause(600)
  }
  await audit(cdp, view.name, audits(view))
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  })
  await writeFile(join(OUT, `${view.name}.png`), Buffer.from(shot.data, "base64"))
  console.log(`  ✓ ${view.name}.png`)
  if (view.after !== undefined) {
    await value(cdp, `(() => { ${view.after}; return true })()`)
    await pause(120)
  }
  await completeFileDrop({ pause }, cdp, heldDrop)
  await pause(120)
}

/**
 * 设置的每一页各拍一张。
 *
 * **七页要一起看**：这块面板有两页要等异步（引擎版本、环境配置），
 * 高度是钉死的，于是「哪一页撑不满、哪一页溢出」只有并排摆着才看得出来。
 * 页名从左列的按钮上现读，不写死——加一页时这里自动跟上。
 */
async function shootSettings(cdp) {
  const tabs = await value(
    cdp,
    `[...document.querySelectorAll('.set__tab')].map(t => t.textContent.trim())`,
  )
  for (const [i, name] of tabs.entries()) {
    await value(cdp, `document.querySelectorAll('.set__tab')[${i}]?.click(); true`)
    // 异步那两页要等内容到齐，否则拍到的是「正在读…」
    await pause(1400)
    await audit(cdp, `设置-${name}`, AUDIT_ALL)
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" })
    const file = `设置-${String(i + 1).padStart(2, "0")}-${name}.png`
    await writeFile(join(OUT, file), Buffer.from(shot.data, "base64"))
    console.log(`  ✓ ${file}`)
  }
}

async function seed(dir) {
  const threads = join(dir, "threads")
  const external = join(dir, "会话碰过的工作区外文件.md")
  await mkdir(threads, { recursive: true })
  await writeFile(external, "# 工作区外文件\n\n这份文件由固定样本模拟引擎读过。\n")
  await writeFile(join(threads, "th-shot.jsonl"), mainThread("th-shot", ROOT, AT, external))
  const stubs = [
    ["th-a", "修一下这个空断言", AT - 3 * 3600_000],
    ["th-b", "看一下断线重连那条链路", AT - 8 * 3600_000],
    ["th-c", "codex 昨天在 x 上说的那个", AT - 3 * 86_400_000],
  ]
  for (const [id, title, at] of stubs)
    await writeFile(join(threads, `${id}.jsonl`), stubThread(id, title, ROOT, at))
  // 工作区不是 Git 仓库的那条：那张「引擎报了 N 个文件」的卡只有在这种 cwd 下才出得来。
  // **cwd 用固定名字的子目录，不用 `dir` 本身**——数据目录是 mkdtemp 出来的
  // （`omni-shot-Jtzj1D`），而侧栏按目录名分组，随机后缀会让每次出图的侧栏都不一样，
  // 「两张图除了改动之外一模一样」当场就不成立了
  const noRepo = join(dir, "临时工作区")
  await mkdir(noRepo, { recursive: true })
  await writeFile(join(threads, "th-norepo.jsonl"), noRepoThread("th-norepo", noRepo, AT - 5 * 3600_000))
  await writeFile(
    join(dir, "settings.json"),
    `${JSON.stringify({
      projects: [ROOT],
      theme: DARK ? "dark" : "light",
      pets: true,
      ...(PET_LIVE ? { defaultEngine: "claude", petKit: { range: true } } : {}),
    })}\n`,
  )
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const port = await freePort()
  const data = await mkdtemp(join(tmpdir(), "omni-shot-"))
  const workspaceFiles = new Set()
  await seed(data)
  const child = spawn(
    electron,
    [DESKTOP, `--user-data-dir=${data}`, `--remote-debugging-port=${port}`, "--disable-gpu"],
    {
      cwd: ROOT,
      env: { ...process.env, OMNI_DEV_THEME: DARK ? "dark" : "light" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  const log = []
  let cdp
  child.stdout.on("data", (c) => log.push(String(c)))
  child.stderr.on("data", (c) => log.push(String(c)))
  try {
    cdp = createCdp(await targetOf(port))
    await cdp.ready
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      ...SIZE,
      deviceScaleFactor: 2,
      mobile: false,
    })
    if (REDUCED) {
      await cdp.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      })
    }
    await waitFor(cdp, "document.querySelector('.shell') !== null", "外壳")
    await value(cdp, axe.source)
    await openFixture({ value, waitFor, pause }, cdp)
    if (PET_LIVE) await openPetLive({ value, waitFor, pause }, cdp)
    for (const view of VIEWS) await shoot(cdp, view, workspaceFiles)
    await shootSettings(cdp)
    cdp.close()
  } catch (error) {
    if (cdp !== undefined) {
      const shot = await cdp
        .send("Page.captureScreenshot", { format: "png" })
        .catch(() => undefined)
      if (shot?.data !== undefined) {
        await writeFile(join(OUT, "00-出图失败现场.png"), Buffer.from(shot.data, "base64"))
      }
    }
    console.error(log.join("").slice(-6000))
    throw error
  } finally {
    child.kill("SIGTERM")
    await pause(400)
    await cleanupWorkspaceFiles(workspaceFiles)
    await rm(data, { recursive: true, force: true })
  }
  console.log(`\n出图目录：${OUT}`)
}

await main()
