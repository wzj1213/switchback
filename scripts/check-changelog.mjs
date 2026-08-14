#!/usr/bin/env node
/**
 * 更新日志守卫 —— 挡住日志格式随时间跑偏。
 *
 * 借鉴 api-post 的两条日志线：`更新日志.md` 面向使用者（三问格式），
 * `docs/工程时间线.md` 是纯工程流水。这里只校验前者的格式与日期序，
 * 「每个用户可见改动都要有条目」无法自动判定，靠 AGENTS.md 的约定。
 */
import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const CHANGELOG = join(ROOT, "更新日志.md")
const TIMELINE = join(ROOT, "docs/工程时间线.md")

const HEADING = /^## (.+) · (\d{4})-(\d{2})-(\d{2})$/
const REQUIRED_BULLETS = ["- 做了什么：", "- 收获：", "- 如何使用："]

const errors = []
const fail = (msg) => errors.push(msg)

function parseEntries(text) {
  const lines = text.split("\n")
  const entries = []
  for (const [index, line] of lines.entries()) {
    if (!line.startsWith("## ")) continue
    const match = HEADING.exec(line)
    if (match === null) {
      fail(`第 ${index + 1} 行标题不符合「## 标题 · YYYY-MM-DD」：${line}`)
      continue
    }
    entries.push({ line: index + 1, title: match[1], date: `${match[2]}-${match[3]}-${match[4]}` })
  }
  // 用下一个 `## ` 作为边界切出每条正文
  for (const [i, entry] of entries.entries()) {
    const end = entries[i + 1] === undefined ? lines.length : entries[i + 1].line - 1
    entry.body = lines.slice(entry.line, end).join("\n")
  }
  return entries
}

function checkChangelog() {
  if (!existsSync(CHANGELOG)) {
    fail("缺少根目录 更新日志.md")
    return
  }
  const entries = parseEntries(readFileSync(CHANGELOG, "utf8"))
  if (entries.length === 0) {
    fail("更新日志.md 没有任何条目")
    return
  }
  for (const entry of entries) {
    const missing = REQUIRED_BULLETS.filter((b) => !entry.body.includes(b))
    if (missing.length > 0) {
      fail(`「${entry.title}」缺少：${missing.join(" ")}`)
    }
  }
  for (let i = 1; i < entries.length; i += 1) {
    const prev = entries[i - 1]
    const cur = entries[i]
    if (cur.date > prev.date) {
      fail(`日期倒序错误：「${cur.title}」(${cur.date}) 应排在「${prev.title}」(${prev.date}) 之前`)
    }
  }
  console.log(`更新日志守卫通过：${entries.length} 条，格式与日期序全绿`)
}

function checkTimeline() {
  if (!existsSync(TIMELINE)) fail("缺少 docs/工程时间线.md")
}

checkChangelog()
checkTimeline()

if (errors.length > 0) {
  console.error(`\n更新日志守卫失败（${errors.length} 项）：\n`)
  for (const e of errors) console.error(`  ✗ ${e}`)
  console.error("")
  process.exit(1)
}
