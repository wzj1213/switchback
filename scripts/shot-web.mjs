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
import axe from "axe-core"
import WebSocket from "ws"

const OUT = process.argv[2] ?? join(process.cwd(), "release", "web-shots")
// 和 harness 的 `SWITCHBACK_HARNESS_PORT` 对上：隧道验证时它跑在 17800
const BASE = `http://127.0.0.1:${process.env["SWITCHBACK_HARNESS_PORT"] ?? "17801"}`
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

async function evaluate(send, expression) {
  const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
  if (reply.exceptionDetails !== undefined) throw new Error(reply.exceptionDetails.text)
  return reply.result.value
}

async function audit(send, label) {
  await evaluate(send, axe.source)
  const violations = await evaluate(
    send,
    `axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }).then(r => r.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })))`,
  )
  if (violations.length > 0) throw new Error(`${label} axe 违规：${JSON.stringify(violations)}`)
  console.log(`  ✓ ${label} axe A/AA`)
}

/**
 * 样本里挂着三组问题（Grok 计划审批、Claude 拒答回退、两题一组的实现路径），全都列在输入框上方。
 * 这几步要的是**两题那组**：一题单选（带可选的补充说明）、一题多选——Tab 要能从上一题走到下一题。
 */
const CARD = `[...document.querySelectorAll(".question-card")].find((c) => c.querySelectorAll(".question-field").length >= 2)`

async function tab(send) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab" })
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab" })
}

async function exerciseQuestion(send) {
  const before = await evaluate(
    send,
    `(() => { const card=${CARD}; const acts=card?.querySelector(".question-card__actions"); if (!card || !acts) return null; const c=card.getBoundingClientRect(); const a=acts.getBoundingClientRect(); return { actionsVisible: a.top >= c.top && a.bottom <= c.bottom + 1, targets: [...card.querySelectorAll(".question-option")].map(x => x.getBoundingClientRect().height) } })()`,
  )
  if (before === null || !before.actionsVisible) throw new Error("问题卡操作行没有留在首屏")
  if (before.targets.some((height) => height < 44)) throw new Error("手机问题选项命中区小于 44px")
  const controls = `[...(${CARD}?.querySelectorAll(".question-option__control") ?? [])]`
  await evaluate(send, `${CARD}?.querySelector(".question-option__control")?.focus()`)
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown" })
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowDown" })
  const radio = await evaluate(
    send,
    `(() => ({ index: ${controls}.indexOf(document.activeElement), checked: document.activeElement?.checked === true }))()`,
  )
  if (radio.index !== 1 || !radio.checked) throw new Error("单选题方向键切换失效")
  await tab(send)
  // 选中一项之后，这一题的「补充说明（可选）」随之可填，Tab 先落在它上面——那是对的顺序，再按一下到下一题
  if (await evaluate(send, `document.activeElement?.classList.contains("question-note__input") === true`)) await tab(send)
  const focused = await evaluate(
    send,
    `(() => { const active=document.activeElement; const ring=active?.closest(".question-option"); return { index: ${controls}.indexOf(active), outline: ring === null || ring === undefined ? "none" : getComputedStyle(ring).outlineStyle, at: active === null ? "" : active.tagName + "." + String(active.className) } })()`,
  )
  if (focused.index !== 2 || focused.outline === "none") {
    throw new Error(`问题选项的 Tab 顺序或焦点环失效：${JSON.stringify(focused)}`)
  }
  await evaluate(
    send,
    `(() => { const card=${CARD}; const fields=card.querySelectorAll(".question-field"); fields[0]?.querySelector("input")?.click(); fields[1]?.querySelector("input")?.click(); return !card.querySelector(".question-card__actions .btn--primary")?.disabled })()`,
  ).then((ready) => {
    if (!ready) throw new Error("逐题选择后回答按钮仍未启用")
  })
  await evaluate(send, `${CARD}?.querySelector(".question-card__actions .btn--primary")?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 350))
  if (await evaluate(send, `${CARD} !== undefined`)) {
    throw new Error("结构化回答发出后问题卡没有落定")
  }
  console.log("  ✓ 手机问题卡命中区、固定操作行、键盘焦点与真实命令往返")
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
      ? `localStorage.removeItem("switchback.token"); location.reload()`
      : `localStorage.setItem("switchback.token", ${JSON.stringify(TOKEN)}); location.reload()`
  await send("Runtime.evaluate", { expression: script })
  await new Promise((r) => setTimeout(r, 1400))
  if (view.setup === "open") {
    // 点开第一条会话（等审批的那条排最前）
    await send("Runtime.evaluate", { expression: `document.querySelector(".threads__list .row")?.click()` })
    await new Promise((r) => setTimeout(r, 700))
  }
  await audit(send, view.name)
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })
  writeFileSync(join(OUT, `${view.name}.png`), Buffer.from(shot.data, "base64"))
  console.log(`  ✓ ${view.name}.png`)
  if (view.name === "phone-thread") await exerciseQuestion(send)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const chrome = spawn(shellPath(), [
    `--remote-debugging-port=${PORT}`,
    "--headless",
    "--hide-scrollbars",
    "--no-sandbox",
    "--user-data-dir=/tmp/switchback-shot-profile",
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
