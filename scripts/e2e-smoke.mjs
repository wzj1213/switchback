#!/usr/bin/env node
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import axe from "axe-core"
import WebSocket from "ws"
import { openPanelPage } from "./shot-panel.mjs"
import { checkThemeCards } from "./shot-theme-cards.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const DESKTOP = join(ROOT, "apps/desktop")
const requireFromDesktop = createRequire(join(DESKTOP, "package.json"))
const electron = requireFromDesktop("electron")

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`  ✓ ${message}`)
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  if (typeof address === "string" || address === null) throw new Error("拿不到 smoke 端口")
  return address.port
}

async function targetOf(port) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const targets = await fetch(`http://127.0.0.1:${String(port)}/json/list`)
      .then((response) => response.json())
      .catch(() => [])
    const page = targets.find(
      (target) => target.type === "page" && typeof target.webSocketDebuggerUrl === "string",
    )
    if (page !== undefined) return page.webSocketDebuggerUrl
    await pause(150)
  }
  throw new Error("Electron 在 20 秒内没有开放 renderer")
}

function createCdp(url) {
  const socket = new WebSocket(url)
  const state = { id: 0, waiting: new Map() }
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw))
    const pending = state.waiting.get(message.id)
    if (pending === undefined) return
    state.waiting.delete(message.id)
    if (message.error === undefined) pending.resolve(message.result)
    else pending.reject(new Error(JSON.stringify(message.error)))
  })
  const ready = new Promise((resolve, reject) => {
    socket.once("open", resolve)
    socket.once("error", reject)
  })
  return {
    ready,
    close: () => socket.close(),
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        state.id += 1
        state.waiting.set(state.id, { resolve, reject })
        socket.send(JSON.stringify({ id: state.id, method, params }))
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

async function key(cdp, keyName, modifiers = 0) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: keyName, modifiers })
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, modifiers })
}

async function waitFor(cdp, expression) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await value(cdp, expression)) return
    await pause(100)
  }
  throw new Error(`界面没有就绪：${expression}`)
}

async function audit(cdp, label) {
  const violations = await value(
    cdp,
    `axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }).then(r => r.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, html: n.html, summary: n.failureSummary })) })))`,
  )
  assert(
    violations.length === 0,
    `${label} 没有 axe A/AA 违规${violations.length === 0 ? "" : `：${JSON.stringify(violations)}`}`,
  )
}

async function scheme(cdp, value) {
  await cdp.send("Emulation.setEmulatedMedia", {
    media: "",
    features: [{ name: "prefers-color-scheme", value }],
  })
  // 主题切换会触发控件的颜色过渡；等稳定后再测对比度，避免采到半途旧字色。
  await pause(250)
}

async function auditSchemes(cdp) {
  // 外壳先于探测和默认会话出现，交互巡检应等输入区真正可用。
  await waitFor(cdp, "document.querySelector('.composer__input:not(:disabled)') !== null")
  await waitFor(cdp, 'document.querySelector(\'.composer__bar [aria-label^="信任档："]:not(:disabled)\') !== null')
  await waitFor(cdp, 'document.querySelector(\'.composer__bar [aria-label^="引擎："]:not(:disabled)\') !== null')
  await pause(250)
  await scheme(cdp, "light")
  await audit(cdp, "浅色主界面")
  await scheme(cdp, "dark")
  await audit(cdp, "深色主界面")
  await scheme(cdp, "light")
}

/**
 * 桌宠**站在该站的地方**。
 *
 * 这一条只能在真 DOM 里验：它们的位置全靠 `paintPets` 写的 inline transform
 * （`.pet` 是 `position:absolute; top:0; left:0`），而「一只都没写过」和
 * 「写错了」在纯逻辑测试里长得一模一样——`pet-seats` 那几条全绿的时候，
 * 应用上五只正叠在活动区左上角。**2026-08-25 就这么漏过一次。**
 */
async function checkPets(cdp) {
  await waitFor(cdp, "document.querySelectorAll('.pet').length > 0")
  const pets = await value(
    cdp,
    `(() => {
      const box = document.querySelector('.pets')
      const list = [...document.querySelectorAll('.pet')]
      return {
        floor: box === null ? 0 : box.clientHeight,
        placed: list.filter((p) => p.style.transform !== "").length,
        total: list.length,
        xs: new Set(list.map((p) => p.style.transform)).size,
        ys: list.map((p) => Math.round(p.getBoundingClientRect().bottom - (box?.getBoundingClientRect().bottom ?? 0))),
      }
    })()`,
  )
  assert(pets.placed === pets.total, `每一只桌宠都拿到了位置（${pets.placed}/${pets.total}）`)
  assert(pets.xs === pets.total, "它们各站各的位，没有叠在一起")
  assert(
    pets.ys.every((gap) => gap <= 0 && gap > -40),
    `它们站在活动区底边上，不是飘在半空（离底 ${pets.ys.join(" / ")}）`,
  )
}

async function checkWorkbench(cdp) {
  for (const step of openPanelPage("文件")) {
    await value(cdp, `(() => { ${step}; return true })()`)
    await pause(80)
  }
  await waitFor(cdp, "document.querySelector('.workbench:not([hidden])') !== null")
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 860, height: 560, deviceScaleFactor: 1, mobile: false,
  })
  await pause(120)
  assert(
    await value(cdp, "getComputedStyle(document.querySelector('.main')).display !== 'none'"),
    "窄窗口并排显示时保留会话主体",
  )
  await waitFor(cdp, "document.querySelector('.workbench:not([hidden])') !== null")
  await audit(cdp, "文件工作台页面")
  assert(
    await value(cdp, "document.querySelector('.workbench').contains(document.activeElement)"),
    "打开文件面板后焦点进入工作台",
  )
  await value(cdp, `document.querySelector('[aria-label="展开侧边面板"]')?.click(); true`)
  await waitFor(cdp, "getComputedStyle(document.querySelector('.main')).display === 'none'")
  assert(true, "展开面板后会话页退出布局")
  await key(cdp, "Escape")
  await waitFor(cdp, "document.querySelector('.workbench[hidden]') !== null")
  assert(
    await value(cdp, "document.activeElement?.getAttribute('aria-label') === '显示侧边面板'"),
    "Esc 关闭面板后焦点回到侧边面板入口",
  )
  await cdp.send("Emulation.clearDeviceMetricsOverride")
  await pause(120)
}

async function inspect(cdp) {
  await waitFor(cdp, "document.querySelector('.shell') !== null")
  const boot = await value(
    cdp,
    `window.omni.appInfo().then(info => ({ bridge: typeof window.omni.send === "function", version: info.version, shell: document.querySelector(".shell") !== null }))`,
  )
  assert(
    boot.bridge && boot.shell && typeof boot.version === "string",
    "sandbox 下 preload 与 renderer 正常启动",
  )
  await value(cdp, axe.source)
  await auditSchemes(cdp)

  await checkPets(cdp)

  await waitFor(cdp, "document.querySelector('.row--group .row__main') !== null")
  await value(
    cdp,
    `(() => { const b=document.querySelector('.row--group .row__main'); const r=b.getBoundingClientRect(); b.focus(); b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 8, clientY: r.top + 8 })); return true })()`,
  )
  await waitFor(cdp, "document.querySelector('[role=menu]') !== null")
  await audit(cdp, "项目菜单")
  const firstMenuItem = await value(
    cdp,
    `document.activeElement?.getAttribute("role") === "menuitem" ? document.activeElement.textContent.trim() : ""`,
  )
  assert(firstMenuItem !== "", "菜单打开后焦点落在第一项")
  await key(cdp, "ArrowDown")
  assert(
    (await value(cdp, "document.activeElement?.textContent.trim()")) !== firstMenuItem,
    "方向键在菜单项之间移动焦点",
  )
  await key(cdp, "Escape")
  await waitFor(cdp, "document.querySelector('[role=menu]') === null")
  assert(
    await value(cdp, "document.activeElement?.matches('.row--group .row__main') === true"),
    "Esc 关闭菜单后焦点回到项目行",
  )

  await checkWorkbench(cdp)

  await value(cdp, `(() => { const b = document.querySelector(".foot__who"); b.focus(); b.click(); return true })()`)
  await waitFor(cdp, "document.querySelector('.set') !== null")
  await audit(cdp, "设置面板")
  await checkThemeCards({ value, waitFor, pause, audit, assert }, cdp)
  const trapped = await value(
    cdp,
    `(() => { const d=document.querySelector(".set"); const a=[...d.querySelectorAll("button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])")]; a.at(-1).focus(); return a.length })()`,
  )
  assert(trapped > 1, "设置面板有可遍历的焦点顺序")
  await key(cdp, "Tab")
  assert(
    await value(cdp, "document.querySelector('.set').contains(document.activeElement)"),
    "Tab 不会走出 aria-modal 面板",
  )
  await key(cdp, "Escape")
  await waitFor(cdp, "document.querySelector('.set') === null")
  assert(
    await value(cdp, "document.activeElement?.classList.contains('foot__who') === true"),
    "Esc 关闭后焦点回到触发器",
  )
}

async function main() {
  const port = await freePort()
  const data = await mkdtemp(join(tmpdir(), "omni-smoke-"))
  await writeFile(join(data, "settings.json"), `${JSON.stringify({ projects: [ROOT] })}\n`)
  const output = []
  const child = spawn(
    electron,
    [
      DESKTOP,
      `--user-data-dir=${data}`,
      `--remote-debugging-port=${String(port)}`,
      "--disable-gpu",
    ],
    {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  child.stdout.on("data", (chunk) => output.push(String(chunk)))
  child.stderr.on("data", (chunk) => output.push(String(chunk)))
  try {
    const cdp = createCdp(await targetOf(port))
    await cdp.ready
    await inspect(cdp)
    cdp.close()
  } catch (error) {
    console.error(output.join("").slice(-12_000))
    throw error
  } finally {
    const exited = child.exitCode === null
      ? new Promise((resolve) => { child.once("exit", resolve) })
      : Promise.resolve()
    child.kill("SIGTERM")
    await exited
    await rm(data, { recursive: true, force: true })
  }
}

await main()
