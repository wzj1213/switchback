#!/usr/bin/env node
/**
 * 从 `apps/desktop/build/icon.source.html` 生成 `icon.png` 和 `icon.icns`。
 *
 * ## 为什么用 chrome-headless-shell
 *
 * **绝对不要用 `Google Chrome.app --headless=new`。** 那个二进制即使 headless
 * 也照样以 `com.google.Chrome` 向 LaunchServices 注册，截图进程活着期间系统
 * 认为 Chrome 已在运行——于是点 Dock 图标的激活事件被发给这个没有窗口的进程，
 * 表现是「Chrome 点了毫无反应」，不报错、不弹窗、极难排查。
 * headless-shell 没有 `.app` bundle，不碰 LaunchServices，而且快一个数量级。
 *
 * 路径按版本变，所以是现查的，不写死。
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const BUILD = join(ROOT, "apps/desktop/build")

/** macOS 的 iconset 要这几个尺寸，一个都不能少。 */
const SIZES = [16, 32, 64, 128, 256, 512, 1024]

function chrome() {
  const base = join(process.env["HOME"] ?? "", ".cache/puppeteer/chrome-headless-shell")
  const versions = readdirSync(base).sort()
  const last = versions[versions.length - 1]
  if (last === undefined) throw new Error("没找到 chrome-headless-shell，先 `npx puppeteer browsers install chrome-headless-shell`")
  return join(base, last, "chrome-headless-shell-mac-arm64/chrome-headless-shell")
}

const shot = join(BUILD, "icon.png")
execFileSync(chrome(), [
  "--headless",
  "--disable-gpu",
  "--hide-scrollbars",
  "--default-background-color=00000000",
  `--screenshot=${shot}`,
  "--window-size=1024,1024",
  // 墙钟看门狗：给 3 秒虚拟时间，卡住的话下面的 timeout 会把它收掉
  "--virtual-time-budget=3000",
  `file://${join(BUILD, "icon.source.html")}`,
], { timeout: 60_000, stdio: "ignore" })

const set = mkdtempSync(join(tmpdir(), "omni-icon-")) + ".iconset"
execFileSync("mkdir", ["-p", set])
for (const size of SIZES) {
  // iconset 的命名是死规矩：`icon_<n>x<n>.png` 和 `icon_<n>x<n>@2x.png`
  execFileSync("sips", ["-z", String(size), String(size), shot, "--out", join(set, `icon_${String(size)}x${String(size)}.png`)], { stdio: "ignore" })
  if (size <= 512) {
    execFileSync("sips", ["-z", String(size * 2), String(size * 2), shot, "--out", join(set, `icon_${String(size)}x${String(size)}@2x.png`)], { stdio: "ignore" })
  }
}
execFileSync("iconutil", ["-c", "icns", set, "-o", join(BUILD, "icon.icns")], { stdio: "inherit" })
rmSync(set, { recursive: true, force: true })
console.log("图标已生成：apps/desktop/build/icon.png + icon.icns")
