#!/usr/bin/env node
/**
 * 给桌面端出图。**界面改动的唯一验收方式。**
 *
 * 用法：`node scripts/shot-app.mjs [输出目录] [--dark]`
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
import WebSocket from "ws"
import { mainThread, stubThread } from "./ui-fixture.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const DESKTOP = join(ROOT, "apps/desktop")
const electron = createRequire(join(DESKTOP, "package.json"))("electron")

const OUT = process.argv[2] ?? join(ROOT, "release", "app-shots")
const DARK = process.argv.includes("--dark")
/**
 * 固定窗口尺寸：前后两张图的像素必须能直接叠着比。
 *
 * `--min` 换成**这个应用允许的最小窗口**（`main/index.ts` 的 minWidth/minHeight）。
 * 那一档值得单独拍：布局塌不塌只在那儿看得出来，而平时没人会把窗口拖到那么小。
 */
const MIN = process.argv.includes("--min")
const SIZE = MIN ? { width: 860, height: 560 } : { width: 1280, height: 860 }
/** 样本的时间戳写死。**不能用 `Date.now()`**——侧栏上那些「3 小时前」会每次都不一样。 */
const AT = 1_756_000_000_000

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
    close: () => socket.close(),
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
  if (reply.exceptionDetails !== undefined) throw new Error(reply.exceptionDetails.text)
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

/**
 * 要拍哪几屏。
 *
 * `open` 把界面摆成那一屏，`ready` 是「摆好了」的判据——**两样都不能省**：
 * 只有 `open` 没有 `ready` 的话，点了没生效也照样出图，四张长得一模一样
 * 而你以为拍到了四屏（第一版就是这样，02/03/04 三张字节数都相同）。
 */
const VIEWS = [
  { name: "01-转录区", open: null, ready: ".md" },
  {
    name: "02-新会话",
    open: `document.querySelector('.sidebar__new')?.click()`,
    ready: ".blank__title",
  },
  {
    name: "03-设置",
    // 侧栏底部那一行**有账号时点开的是菜单**，没账号时才直接进设置
    //（见 `SidebarFoot.tsx`：「一行只做一件事」）。所以这里走两步，
    // 而不是假设它一点就开——本机跑 smoke 时没账号，出图时有，两边不一样
    open: [
      `(() => { const b=document.querySelector('.foot__who'); b?.focus(); b?.click() })()`,
      `[...document.querySelectorAll('[role=menuitem]')].find(m => m.textContent.includes('设置'))?.click()`,
    ],
    ready: ".set",
  },
]

async function shoot(cdp, view) {
  if (view.open !== null) {
    for (const step of [view.open].flat()) {
      await value(cdp, `(() => { ${step}; return true })()`)
      await pause(350)
    }
    await waitFor(cdp, `document.querySelector('${view.ready}') !== null`, view.name)
    await pause(600)
  }
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  })
  await writeFile(join(OUT, `${view.name}.png`), Buffer.from(shot.data, "base64"))
  console.log(`  ✓ ${view.name}.png`)
}

/**
 * 把样本那条会话点开。
 *
 * 分两步是因为侧栏默认**折着**：项目组先展开，会话行才存在。
 * 这一段每一步都等到「东西真的出现了」再走下一步，不靠 `sleep` 撞运气——
 * 撞出来的图会时好时坏，而出图这条路一旦不可信就等于没有。
 */
async function openFixture(cdp) {
  await waitFor(cdp, "document.querySelector('.row--group .row__main') !== null", "项目组")
  // 点的是 `.row__main` 不是 `.row`——整行是个容器，能点的是里面那块
  await value(cdp, `document.querySelector('.row--group .row__main')?.click(); true`)
  await waitFor(cdp, "document.querySelectorAll('.row--thread').length > 0", "会话列表")
  // 两条都踩过：能点的是 `.row__main`（点 `.row` 不报错也不生效）；
  // 而**侧栏上写的是首条提问、不是 `thread.title`**，所以别按标题去找——
  // 找不到时 `?.click()` 一声不响，图照出，只是内容全错
  await value(cdp, `document.querySelector('.row--thread .row__main')?.click(); true`)
  await waitFor(cdp, "document.querySelector('.md') !== null", "转录区正文")
  await pause(900)
}

async function seed(dir) {
  const threads = join(dir, "threads")
  await mkdir(threads, { recursive: true })
  await writeFile(join(threads, "th-shot.jsonl"), mainThread("th-shot", ROOT, AT))
  const stubs = [
    ["th-a", "修一下这个空断言", AT - 3 * 3600_000],
    ["th-b", "看一下断线重连那条链路", AT - 8 * 3600_000],
    ["th-c", "codex 昨天在 x 上说的那个", AT - 3 * 86_400_000],
  ]
  for (const [id, title, at] of stubs)
    await writeFile(join(threads, `${id}.jsonl`), stubThread(id, title, ROOT, at))
  await writeFile(
    join(dir, "settings.json"),
    `${JSON.stringify({ projects: [ROOT], theme: DARK ? "dark" : "light", pets: true })}\n`,
  )
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const port = await freePort()
  const data = await mkdtemp(join(tmpdir(), "omni-shot-"))
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
  child.stdout.on("data", (c) => log.push(String(c)))
  child.stderr.on("data", (c) => log.push(String(c)))
  try {
    const cdp = createCdp(await targetOf(port))
    await cdp.ready
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      ...SIZE,
      deviceScaleFactor: 2,
      mobile: false,
    })
    await waitFor(cdp, "document.querySelector('.shell') !== null", "外壳")
    await openFixture(cdp)
    for (const view of VIEWS) await shoot(cdp, view)
    cdp.close()
  } catch (error) {
    console.error(log.join("").slice(-6000))
    throw error
  } finally {
    child.kill("SIGTERM")
    await pause(400)
    await rm(data, { recursive: true, force: true })
  }
  console.log(`\n出图目录：${OUT}`)
}

await main()
