#!/usr/bin/env node
/**
 * 设计 token 守卫 —— 挡住「引用了一个不存在的 token」。
 * 用法：node scripts/check-tokens.mjs
 *
 * ## 为什么要一条专门的守卫
 *
 * CSS 里 `var(--没定义的)` **不报错、不警告、也不退回默认值**：它让整条声明作废。
 * 一次审计在这套样式里逮到 9 个从未定义过的名字、15 条声明因此静默失效——
 * 发送键的文字是继承来的深色（压在蓝底上 3.79:1）、停止键根本没有底色、
 * 缩略图是直角、npm 报错原文用界面无衬线字体渲染。**每一条都写了，每一条都没跑。**
 *
 * 更阴的是 `border: 2px solid var(--没定义的)` 这种**简写**：整条作废意味着
 * `border-style` 退回 `none`，注释里精心解释的那圈描边一天都没出现过。
 *
 * 这类 bug 靠眼睛发现一次就够了，第二次该由 CI 发现。
 *
 * ## 判据
 *
 * - 定义集**扫全部 css 文件**，不只是 tokens.css：`--sb-pad` / `--sb-slot` /
 *   `--sb-row-h` / `--sb-act` 定义在 app.css 的 `.sidebar` 规则里，那是有意的
 *   （它们只属于侧栏），不该因此被判成未定义。
 * - `var(--x, 兜底值)` 两参形式**跳过**：那是合法写法，作者已经给了退路。
 * - **每一端各算各的。** 桌面渲染层和浏览器端是两套独立的样式，各有各的色板；
 *   合成一个集合的话，浏览器端引用一个只在桌面端定义过的名字会被判成通过，
 *   而它在真的页面上照样作废——那正是这条守卫要挡的东西。
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/** 各自独立的样式根。新增一端就在这里加一行。 */
const ROOTS = [
  { name: "desktop", dir: join(ROOT, "apps/desktop/src/renderer/styles") },
  { name: "web", dir: join(ROOT, "apps/web/src") },
]

/** `--x: 值` 的左边。允许出现在任何规则里，不限 `:root`。 */
const DEFINE = /(^|[{;\s])(--[a-z0-9-]+)\s*:/g
/**
 * `@property --x { … }`。**这也是一种定义**，而且是唯一一种能被动画插值的：
 * 漏认它的话，一个正经注册过的属性会被判成「引用了没定义的 token」。
 */
const REGISTER = /@property\s+(--[a-z0-9-]+)/g
/** `var(--x)`；带兜底的两参形式不算，见文件头。 */
const USE = /var\(\s*(--[a-z0-9-]+)\s*\)/g

function sheets(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".css"))
    .map((f) => ({ file: f, text: readFileSync(join(dir, f), "utf8") }))
}

/** 一端的检查。返回 `{ files, defined, missing }`。 */
function audit({ name, dir }) {
  const files = sheets(dir)
  if (files.length === 0) {
    console.error(`token 守卫失败：${name} 下一个 css 文件都没找到（${dir}）`)
    process.exit(1)
  }
  const defined = new Set()
  for (const { text } of files) {
    for (const m of text.matchAll(DEFINE)) defined.add(m[2])
    for (const m of text.matchAll(REGISTER)) defined.add(m[1])
  }
  const missing = []
  for (const { file, text } of files) {
    text.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(USE)) {
        if (!defined.has(m[1])) missing.push(`${name}/${file}:${String(i + 1)} 引用了没有定义的 ${m[1]}`)
      }
    })
  }
  return { files, defined, missing }
}

function main() {
  const results = ROOTS.map(audit)
  const missing = results.flatMap((r) => r.missing)
  if (missing.length > 0) {
    console.error(`\ntoken 守卫失败（${String(missing.length)} 处）：\n`)
    for (const m of missing) console.error(`  ✗ ${m}`)
    console.error("\n提示：CSS 里未定义的 var() 会让**整条声明**作废，不报错也不回退。\n")
    process.exit(1)
  }
  const files = results.reduce((n, r) => n + r.files.length, 0)
  const tokens = results.reduce((n, r) => n + r.defined.size, 0)
  console.log(`token 守卫通过：${String(ROOTS.length)} 端 / ${String(files)} 个样式文件 / ${String(tokens)} 个 token，引用全部有定义`)
}

main()
