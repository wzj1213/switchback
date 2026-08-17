#!/usr/bin/env node
/**
 * 给浏览器端出图。**开着 harness 时用**（`pnpm harness:web`）。
 *
 * 用法：`node scripts/shot-web.mjs [输出目录]`
 *
 * ## 为什么走 CDP 而不是 `--screenshot`
 *
 * 那个参数只能「打开一个 URL 然后拍一张」，而这一端第一屏是**配对屏**——
 * 要看到列表和正文，得先往 `localStorage` 里塞一个令牌。所以必须能执行 JS，
 * 也就必须走调试协议。
 *
 * ## 为什么是 chrome-headless-shell 而不是 Chrome.app
 *
 * `Chrome.app --headless` 即使无头也照样以 `com.google.Chrome` 向 LaunchServices
 * 注册，截图进程活着期间系统认为 Chrome 已在运行，于是把 Dock 点击的「激活」
 * 事件发给这个**没有窗口**的进程——点图标毫无反应，不报错、不弹窗、
 * 也不产生崩溃日志。`--user-data-dir` 隔离不了这个注册。
 * headless-shell 没有 `.app` bundle，不碰 LaunchServices，顺带还快一个量级。
 */
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import WebSocket from "ws"

const OUT = process.argv[2] ?? join(process.cwd(), "release", "web-shots")
const BASE = "http://127.0.0.1:17801"
const TOKEN = "harness-dev-token-not-a-secret"
const PORT = 9333
/** 墙钟看门狗：`--virtual-time-budget` 说好 4 秒，跑过这个数就是卡死了。 */
const DEADLINE_MS = 60_000

/** 最新的一份 chrome-headless-shell。**路径按版本变，不写死。** */
function shellPath() {
  const root = join(homedir(), ".cache/puppeteer/chrome-headless-shell")
  const versions = readdirSync(root).sort()
  const last = versions[versions.length - 1]
  return join(root, last, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
}

const VIEWS = [
  { name: "phone-list", w: 390, h: 844, scale: 3, path: "/", setup: null },
  { name: "phone-thread", w: 390, h: 844, scale: 3, path: "/", setup: "open" },
  { name: "phone-pair", w: 390, h: 844, scale: 3, path: "/", setup: "unpair" },
  { name: "desktop", w: 1200, h: 800, scale: 2, path: "/", setup: "open" },
]

function rpc(socket, state) {
  return (method, params = {}, sessionId) =>
    new Promise((done, fail) => {
      state.id += 1
      const id = state.id
      state.waiting.set(id, { done, fail })
      socket.send(JSON.stringify(sessionId === undefined ? { id, method, params } : { id, method, params, sessionId }))
    })
}

async function shoot(send, view) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: view.w,
    height: view.h,
    deviceScaleFactor: view.scale,
    mobile: view.w < 500,
  })
  await send("Page.navigate", { url: BASE + view.path })
  await new Promise((r) => setTimeout(r, 900))
  // 令牌塞进 localStorage 再重载：第一屏是配对屏，不塞就只能拍到那一屏
  const script =
    view.setup === "unpair"
      ? `localStorage.removeItem("omni.token"); location.reload()`
      : `localStorage.setItem("omni.token", ${JSON.stringify(TOKEN)}); location.reload()`
  await send("Runtime.evaluate", { expression: script })
  await new Promise((r) => setTimeout(r, 1400))
  if (view.setup === "open") {
    // 点开第一条会话（等审批的那条排最前）
    await send("Runtime.evaluate", { expression: `document.querySelector(".threads__list .row")?.click()` })
    await new Promise((r) => setTimeout(r, 700))
  }
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })
  writeFileSync(join(OUT, `${view.name}.png`), Buffer.from(shot.data, "base64"))
  console.log(`  ✓ ${view.name}.png`)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const chrome = spawn(shellPath(), [
    `--remote-debugging-port=${PORT}`,
    "--headless",
    "--hide-scrollbars",
    "--no-sandbox",
    "--user-data-dir=/tmp/omni-shot-profile",
    "about:blank",
  ])
  const kill = () => {
    chrome.kill("SIGKILL")
  }
  const watchdog = setTimeout(() => {
    console.error("超时：headless shell 卡住了，直接 kill")
    kill()
    process.exit(1)
  }, DEADLINE_MS)

  await new Promise((r) => setTimeout(r, 1200))
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const target = list.find((t) => t.type === "page")
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const state = { id: 0, waiting: new Map() }
  socket.on("message", (raw) => {
    const msg = JSON.parse(String(raw))
    const pending = state.waiting.get(msg.id)
    if (pending === undefined) return
    state.waiting.delete(msg.id)
    if (msg.error) pending.fail(new Error(JSON.stringify(msg.error)))
    else pending.done(msg.result)
  })
  await new Promise((r) => socket.once("open", r))
  const send = rpc(socket, state)
  await send("Page.enable")
  await send("Runtime.enable")

  console.log(`出图到 ${OUT}`)
  for (const view of VIEWS) await shoot(send, view)

  clearTimeout(watchdog)
  socket.close()
  kill()
  console.log("完成")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
