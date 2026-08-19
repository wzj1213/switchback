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

/** 这个脚本自己写的那个文件（仓库相对路径，`git status` 里就是这个写法）。 */
const STAMPED = "apps/desktop/package.json"

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

/**
 * 工作区有没有**这个脚本自己写的之外**的改动。
 *
 * ## 为什么不能直接看 `git status --porcelain`
 *
 * 因为这个脚本**每次打包都会改 `apps/desktop/package.json`**（版本号 + 构建戳），
 * 而那个改动是不提交的。于是从第二次打包起，`git status` 永远非空——
 * **`-dirty` 就恒为真，再也分辨不出任何东西**。两台机器上的包都挂着 `-dirty`，
 * 而其中一份可能真的对应一次干净的提交，另一份可能真有未提交的源码改动，
 * 标记却一模一样。一个永远亮着的告警等于没有告警。
 *
 * 判据：把这个文件从清单里摘掉，**但只在它的差异确实只有这个脚本写的那几样时**——
 * 有人手改了依赖或脚本，那仍然是真的脏。
 *
 * 造了个临时仓库把四种情况都真跑过（2026-08-19）：干净 → 干净；
 * 第二次打包（上次的戳还在文件里）→ **干净**（这条就是修的那个）；
 * 多一个未跟踪文件 → 脏；手改 `package.json` 的真实字段 → 脏。
 */
function isDirty() {
  const lines = git("status", "--porcelain").split("\n").filter((l) => l.trim() !== "")
  const others = lines.filter((l) => !l.endsWith(STAMPED))
  if (others.length > 0) return true
  return lines.length > 0 && !onlyStampDiffers()
}

/**
 * 那个文件此刻与 HEAD 的差异，是不是**只有这个脚本自己写的那三样**。
 *
 * 三样必须和下面 `pkg.version` / `pkg.omni` 那两行完全对应——漏一个就会
 * 把一次干净的构建判成脏（`repo` 就漏过一次：换一台机器打包它必然不同）。
 */
function onlyStampDiffers() {
  const head = git("show", `HEAD:${STAMPED}`)
  if (head === "") return false
  try {
    const bare = (text) => {
      const o = JSON.parse(text)
      delete o.version
      if (o.omni !== undefined) {
        delete o.omni.build
        delete o.omni.repo
      }
      return JSON.stringify(o)
    }
    return bare(head) === bare(readFileSync(join(ROOT, STAMPED), "utf8"))
  } catch {
    return false
  }
}

function compute() {
  const tag = lastTag()
  const range = tag === undefined ? "HEAD" : `${tag}..HEAD`
  const count = Number(git("rev-list", "--count", range) || "0")
  const sha = git("rev-parse", "--short", "HEAD") || "unknown"
  const dirty = isDirty()
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
/**
 * `repo` = **这个包是从哪份源码打出来的**（绝对路径）。
 *
 * 装好的应用靠它把自己重新构建、重新装上（见 `main/selfupdate.ts`）——
 * 少掉「切终端 → 打包 → 挂 DMG → 拖进 /Applications」这一整段。
 *
 * 拷到别人机器上时这个路径不存在，那边的自更新入口整个不出现——
 * **不是灰掉，是不画**。所以烤进去的代价只有一行字符串，没有别的。
 */
pkg.omni = { ...(pkg.omni ?? {}), build, repo: ROOT }
writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
console.log(`版本 → ${version}+${build}（源码 ${ROOT}）`)
