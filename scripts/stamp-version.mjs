#!/usr/bin/env node
/**
 * 从 git 推出版本号，写进 `apps/desktop/package.json`。**打包前跑。**
 *
 * ## 为什么版本必须能定位到一次构建
 *
 * 原来它恒为 `0.0.0`。于是任何一份 bug 报告都回答不了「你装的是哪一版」——
 * 而这恰恰是收到报告后第一个要问的问题。
 *
 * ## 规则
 *
 *   0.<自上个 tag 起的提交数>.0+<短 sha>
 *
 * 「提交多了版本就往上走」是自动的，不用记得手动改；
 * 而短 sha 让**每一次构建都能精确定位到那次提交**，
 * 哪怕两次构建之间没有新提交（改了配置重打一次也分得清）。
 *
 * 打过 tag 就从 tag 续：`v0.2.0` 之后再攒 7 个提交 → `0.2.7`。
 * 没有 tag 时用全部提交数，至少保证单调递增。
 *
 * **不自动打 tag**：发版是个人的决定，脚本只负责让版本号说实话。
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return ""
  }
}

/** 最近的 `vX.Y.Z` tag。没有就返回 undefined。 */
function lastTag() {
  const tag = git("describe", "--tags", "--abbrev=0", "--match", "v*")
  return /^v\d+\.\d+\.\d+$/.test(tag) ? tag : undefined
}

function compute() {
  const tag = lastTag()
  const range = tag === undefined ? "HEAD" : `${tag}..HEAD`
  const count = Number(git("rev-list", "--count", range) || "0")
  const sha = git("rev-parse", "--short", "HEAD") || "unknown"
  const dirty = git("status", "--porcelain") !== ""
  const [major, minor] = tag === undefined ? [0, 0] : tag.slice(1).split(".").map(Number)
  // 工作区脏的时候标出来：那份产物不对应任何一次提交，装到别人机器上时
  // 「哪一版」这个问题会永远问不清
  return {
    version: `${String(major)}.${String(minor)}.${String(count)}`,
    build: dirty ? `${sha}-dirty` : sha,
  }
}

const file = join(ROOT, "apps/desktop/package.json")
const pkg = JSON.parse(readFileSync(file, "utf8"))
const { version, build } = compute()
pkg.version = version
pkg.omni = { ...(pkg.omni ?? {}), build }
writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`版本 → ${version}+${build}`)
