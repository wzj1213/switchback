#!/usr/bin/env node
/**
 * 架构守卫 —— 在 CI 里挡住依赖回流和文档缺失。
 * 用法：node scripts/check-arch.mjs
 *
 * 它检查三件事，都是上一版（crew）踩过的坑：
 *   1. 包必须有 README 且写清「不拥有什么」——写不出边界就是没划边界
 *   2. 依赖方向不得回流、不得成环——crew 的 30 个文件同属一个包，任何符号互相可见
 *   3. 纯逻辑包不得有运行时依赖——保证 protocol / approval 可被穷举测试
 */
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { PACKAGE_GRAPH, renderPackageGraph } from "./package-graph.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/** 这些包不得有任何运行时依赖（devDependencies 不限）。 */
const PURE = new Set(["@switchback/protocol", "@switchback/approval"])

const REQUIRED_README_SECTIONS = ["## 拥有什么", "## 不拥有什么", "## 已知限制"]

const errors = []
const fail = (msg) => errors.push(msg)

function discover() {
  const out = []
  for (const group of ["packages", "apps"]) {
    const dir = join(ROOT, group)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (!name.isDirectory()) continue
      const pkgPath = join(dir, name.name, "package.json")
      if (!existsSync(pkgPath)) continue
      out.push({
        dir: join(dir, name.name),
        json: JSON.parse(readFileSync(pkgPath, "utf8")),
      })
    }
  }
  return out
}

function checkReadme({ dir, json }) {
  const readme = join(dir, "README.md")
  if (!existsSync(readme)) {
    fail(`${json.name}: 缺少 README.md`)
    return
  }
  const text = readFileSync(readme, "utf8")
  for (const section of REQUIRED_README_SECTIONS) {
    if (!text.includes(section)) fail(`${json.name}: README 缺少「${section}」小节`)
  }
}

function checkDependencies({ json }) {
  const allowed = PACKAGE_GRAPH[json.name]
  if (allowed === undefined) {
    fail(`${json.name}: 未在 scripts/package-graph.mjs 登记`)
    return
  }
  const actual = Object.keys(json.dependencies ?? {}).filter((dep) => dep.startsWith("@switchback/"))
  for (const dep of actual) {
    if (PACKAGE_GRAPH[dep] === undefined) fail(`${json.name} → ${dep}: 目标未在精确依赖图登记`)
    else if (!allowed.includes(dep)) fail(`${json.name} → ${dep}: 精确依赖图中没有这条边`)
  }
  for (const dep of allowed)
    if (!actual.includes(dep)) fail(`${json.name} → ${dep}: 图中有边但 package.json 已缺失`)
}

function checkGraphPackages(pkgs) {
  const discovered = new Set(pkgs.map((pkg) => pkg.json.name))
  for (const name of Object.keys(PACKAGE_GRAPH)) {
    if (!discovered.has(name)) fail(`${name}: 依赖图登记了包，但工作区里没有发现它`)
  }
}

function checkGraphDocs(file) {
  const text = readFileSync(join(ROOT, file), "utf8")
  const match = text.match(
    /<!-- package-graph:start -->\n```text\n([\s\S]*?)\n```\n<!-- package-graph:end -->/,
  )
  if (match?.[1] !== renderPackageGraph())
    fail(`${file}: 包依赖图与 scripts/package-graph.mjs 不一致`)
}

function checkPure({ json }) {
  if (!PURE.has(json.name)) return
  const deps = Object.keys(json.dependencies ?? {}).filter((d) => !d.startsWith("@switchback/"))
  if (deps.length > 0) {
    fail(`${json.name}: 纯逻辑包不得有运行时依赖，实际有 ${deps.join(", ")}`)
  }
}

function main() {
  const pkgs = discover()
  if (pkgs.length === 0) fail("没有发现任何工作区包")
  checkGraphPackages(pkgs)
  checkGraphDocs("AGENTS.md")
  checkGraphDocs("README.md")
  for (const pkg of pkgs) {
    checkReadme(pkg)
    checkDependencies(pkg)
    checkPure(pkg)
  }

  if (errors.length > 0) {
    console.error(`\n架构守卫失败（${errors.length} 项）：\n`)
    for (const e of errors) console.error(`  ✗ ${e}`)
    console.error("")
    process.exit(1)
  }
  console.log(`架构守卫通过：${pkgs.length} 个包，精确依赖边与文档契约全绿`)
}

main()
