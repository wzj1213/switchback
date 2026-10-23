#!/usr/bin/env node
/**
 * 界面文案守卫 —— 挡住「把中文直接写进组件」。
 * 用法：node scripts/check-i18n.mjs        检查
 *       node scripts/check-i18n.mjs --list 列出每个文件还剩几条（迁移时看进度用）
 *
 * ## 规矩
 *
 * 界面上的字放在同名的 `*.messages.ts` 里，用 `@switchback/i18n` 的 `defineMessages`
 * 写中英两版。这里用 TypeScript 的语法树找代码里**含中文的字符串和 JSX 文本**（注释不算、测试不算）：
 *
 * - 文件不在 `scripts/i18n-todo.json`（改名单前的旧文件）里却含中文文案 → 报错。新代码从一开始就走 messages。
 * - 名单里的文件已经一条都不剩 → 也报错：迁完了就从名单里删掉，名单只会越来越短。
 * - 确实要写中文的（比如匹配中文标点的正则），在那一行或上一行写 `i18n-ok` 并说明为什么。
 *
 * ## 管哪些目录
 *
 * 先管纯界面的两处：桌面端渲染层与网页端。主进程和各个包里还混着只给开发看的日志，
 * 迁到那一步时再把它们加进 ROOTS（连同「日志不算」的判据）。
 */
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ts = createRequire(join(ROOT, "package.json"))("typescript")
const ROOTS = ["apps/desktop/src/renderer/", "apps/web/src/"]
const TODO_FILE = join(ROOT, "scripts/i18n-todo.json")
const CJK = /[\u3400-\u9fff\uff00-\uffef\u3000-\u303f]/
const SKIP = /\.test\.tsx?$|\.d\.ts$|\.messages\.ts$/
const TEXT_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
])

function sources() {
  const out = execFileSync("git", ["-C", ROOT, "-c", "core.quotepath=off", "ls-files", "-co", "--exclude-standard"], { encoding: "utf8" })
  return out.split("\n").filter((f) => /\.tsx?$/.test(f) && !SKIP.test(f) && ROOTS.some((r) => f.startsWith(r)))
}

/** 一个文件里含中文的文案：[行号, 文字]。 */
function hits(file) {
  const src = readFileSync(join(ROOT, file), "utf8")
  const lines = src.split("\n")
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found = []
  const visit = (node) => {
    if (TEXT_KINDS.has(node.kind) && CJK.test(node.text)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line
      const ok = /i18n-ok/.test(lines[line] ?? "") || /i18n-ok/.test(lines[line - 1] ?? "")
      if (!ok) found.push([line + 1, node.text.trim().slice(0, 40)])
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

function main() {
  const todo = new Set(JSON.parse(readFileSync(TODO_FILE, "utf8")))
  const files = sources()
  const present = new Set(files)
  const errors = []
  const left = []
  for (const file of files) {
    const found = hits(file)
    if (found.length === 0) {
      if (todo.has(file)) errors.push(`${file}: 已经没有写死的中文了，从 scripts/i18n-todo.json 里删掉它`)
      continue
    }
    if (todo.has(file)) {
      left.push([found.length, file])
      continue
    }
    const [line, text] = found[0]
    errors.push(`${file}:${String(line)}: 界面文案写死成了中文（「${text}」等 ${String(found.length)} 处）——放进同名的 *.messages.ts`)
  }
  for (const file of todo) if (!present.has(file)) errors.push(`${file}: 文件已经不在了，从 scripts/i18n-todo.json 里删掉它`)
  if (process.argv.includes("--list")) {
    for (const [n, file] of left.sort((a, b) => b[0] - a[0])) console.log(String(n).padStart(5), file)
  }
  if (errors.length > 0) {
    for (const e of errors) console.error(`✗ ${e}`)
    process.exit(1)
  }
  const total = left.reduce((sum, [n]) => sum + n, 0)
  console.log(`界面文案守卫通过：${ROOTS.join("、")} 里还有 ${String(left.length)} 个旧文件待迁（${String(total)} 条）`)
}

main()
