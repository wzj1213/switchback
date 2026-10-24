#!/usr/bin/env node
/**
 * 界面文案守卫 —— 挡住「把中文直接写进组件」。
 * 用法：node scripts/check-i18n.mjs         检查
 *       node scripts/check-i18n.mjs --list  列出每个文件还剩几条（迁移时看进度用）
 *       node scripts/check-i18n.mjs --prune 把已经迁完、或已经删掉的文件从名单里划掉
 *
 * ## 规矩
 *
 * 界面上的字放在同名的 `*.messages.ts` 里，用 `@switchback/i18n` 的 `defineMessages`
 * 写中英两版。这里用 TypeScript 的语法树找代码里**含中文的字符串和 JSX 文本**（注释不算、测试不算）：
 *
 * - 文件不在 `scripts/i18n-todo.json`（改名单前的旧文件）里却含中文文案 → 报错。新代码从一开始就走 messages。
 * - 名单里的文件已经一条都不剩 → 也报错：迁完了就从名单里删掉，名单只会越来越短。
 * - 确实要写中文的（比如匹配中文标点的正则、只写进日志文件的脚本输出），在那一行或上一行写 `i18n-ok`
 *   并说明为什么；写在一条语句的上一行，就管住这一整条语句。
 * - **日志不算**：落在 `log.write(…)`、`logger.write(…)`、`deps.log(…)`、`console.*(…)` 这类调用里的字
 *   只给排查的人看，不迁。判据是「它在哪个调用的参数里」，所以别把界面文案塞进日志调用再拿出来用。
 *
 * ## 管哪些目录
 *
 * 渲染层、网页端、主进程（含 `shared/`、`preload/`），以及全部 `packages/`。包里写给模型看的那几句
 *（交接说明、审批拒绝的理由）也跟着界面语言走——那是 2026-10 定下的，见 `docs/工程时间线.md`。
 *
 * 别的会话还没提交、正在写的新目录如果一时迁不完，可以临时放进 `EXCLUDE`，免得它落地时被这道闸挡住；
 * 落地之后删掉那一行，再照常迁它的文案。眼下是空的。
 */
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ts = createRequire(join(ROOT, "package.json"))("typescript")
const ROOTS = ["apps/desktop/src/renderer/", "apps/web/src/", "apps/desktop/src/main/", "apps/desktop/src/shared/", "apps/desktop/src/preload/", "packages/"]
/** 临时放过的目录（见文件头）。 */
const EXCLUDE = []
const TODO_FILE = join(ROOT, "scripts/i18n-todo.json")
const CJK = /[\u3400-\u9fff\uff00-\uffef\u3000-\u303f]/
const SKIP = /\.test\.tsx?$|\.d\.ts$|\.messages\.ts$/
/** 日志调用：落在它们参数里的字只给排查的人看。 */
const LOG_CALL = /(^|\.)(log|logger)(\.(write|info|warn|error|debug))?$|^console\.\w+$/
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
  return out.split("\n").filter((f) =>
    /\.tsx?$/.test(f) && !SKIP.test(f) && ROOTS.some((r) => f.startsWith(r)) && !EXCLUDE.some((x) => f.startsWith(x)))
}

/** 往上找到同一个函数里的调用：有一层是日志调用就算日志。 */
function inLog(node, sf) {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (ts.isFunctionLike(at) || ts.isSourceFile(at)) return false
    if (ts.isCallExpression(at) && LOG_CALL.test(at.expression.getText(sf).replace(/\s+/g, ""))) return true
  }
  return false
}

/** 这个节点所在的那条语句从哪一行开始（`i18n-ok` 写在它上一行，管住整条语句）。 */
function statementLine(node, sf) {
  let at = node
  while (at.parent !== undefined && !ts.isBlock(at.parent) && !ts.isSourceFile(at.parent) && !ts.isCaseClause(at.parent)) at = at.parent
  return sf.getLineAndCharacterOfPosition(at.getStart(sf)).line
}

/** 一个文件里含中文的文案：[行号, 文字]。 */
function hits(file) {
  const src = readFileSync(join(ROOT, file), "utf8")
  const lines = src.split("\n")
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const marked = (line) => /i18n-ok/.test(lines[line] ?? "") || /i18n-ok/.test(lines[line - 1] ?? "")
  const found = []
  const visit = (node) => {
    if (TEXT_KINDS.has(node.kind) && CJK.test(node.text) && !inLog(node, sf)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line
      if (!marked(line) && !marked(statementLine(node, sf))) found.push([line + 1, node.text.trim().slice(0, 40)])
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** 名单只会变短：迁完的、删掉的划掉，别的一个不动。 */
function prune(todo, files) {
  const present = new Set(files)
  const keep = [...todo].filter((file) => present.has(file) && hits(file).length > 0)
  writeFileSync(TODO_FILE, `${JSON.stringify(keep, null, 2)}\n`)
  console.log(`从名单里划掉 ${String(todo.size - keep.length)} 个，还剩 ${String(keep.length)} 个`)
}

function main() {
  const todo = new Set(JSON.parse(readFileSync(TODO_FILE, "utf8")))
  const files = sources()
  if (process.argv.includes("--prune")) return prune(todo, files)
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
