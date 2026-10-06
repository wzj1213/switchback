#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const DESKTOP = join(ROOT, "apps/desktop")
const PACKAGE = join(DESKTOP, "package.json")
const MAC_OUTPUT = join(ROOT, "release/mac-arm64")

function git(...args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return ""
  }
}

function lastTag() {
  const tag = git("describe", "--tags", "--abbrev=0", "--match", "v*")
  return /^v\d+\.\d+\.\d+$/.test(tag) ? tag : undefined
}

export function buildIdentity() {
  const tag = lastTag()
  const range = tag === undefined ? "HEAD" : `${tag}..HEAD`
  const count = Number(git("rev-list", "--count", range) || "0")
  const sha = git("rev-parse", "--short", "HEAD") || "unknown"
  const [major, minor] = tag === undefined ? [0, 0] : tag.slice(1).split(".").map(Number)
  const dirty = git("status", "--porcelain") !== ""
  return {
    version: `${String(major)}.${String(minor)}.${String(count)}`,
    build: dirty ? `${sha}-dirty` : sha,
  }
}

/**
 * 打包用的 Electron 直接取 `electron` 包已经解好的那一份（`node_modules/electron/dist`）。
 *
 * 不给的话 electron-builder 走 `@electron/get`：缓存里明明有同版本的 zip，它也要**每次现下一份
 * `SHASUMS256.txt`** 去 GitHub 校验（源码注释原话：“Never use the cache for loading checksums”）。
 * 连 GitHub 不稳的机器上打包就卡在这一步——2026-09-26 那台连着四次 ECONNRESET / 十分钟超时，
 * 往缓存里拷 zip 也没用。这一份是 `electron` 包装的时候按它自带的 checksums.json 校验过的，
 * 版本对得上就用它；对不上（或还没解出来）就退回原来那条下载的路，不硬用一份错版本的。
 */
export function electronDistOf(desktop = DESKTOP) {
  const pkg = join(desktop, "node_modules/electron")
  const dist = join(pkg, "dist")
  try {
    const wanted = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version
    const got = readFileSync(join(dist, "version"), "utf8").trim()
    return got === wanted && existsSync(join(dist, "Electron.app")) ? dist : undefined
  } catch {
    return undefined
  }
}

export function builderConfig(mode, identity, sourcePackage, electronDist = electronDistOf()) {
  const thin = mode === "thin"
  return {
    extends: join(DESKTOP, "electron-builder.yml"),
    ...(electronDist === undefined ? {} : { electronDist }),
    extraMetadata: {
      version: identity.version,
      switchback: {
        ...(sourcePackage.switchback ?? {}),
        build: identity.build,
        repo: ROOT,
        claudeExecutable: thin ? "system" : "bundled",
      },
    },
    artifactName: thin
      ? "${productName}-${version}-${arch}-thin.${ext}"
      : "${productName}-${version}-${arch}.${ext}",
    ...(thin
      ? {
          files: ["out/**", "package.json", "!node_modules/@anthropic-ai/claude-agent-sdk-*/**"],
        }
      : {}),
  }
}

function run(command, args, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env, stdio: "inherit" })
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${command} 失败（code ${String(code)} signal ${String(signal)}）`))
    })
  })
}

async function packageMode(mode, identity, sourcePackage, options) {
  const dir = await mkdtemp(join(tmpdir(), `switchback-builder-${mode}-`))
  const config = join(dir, "config.json")
  try {
    // electron-builder 不总能可靠覆盖既有 Electron.app；干净解包目录才可复现。
    await rm(MAC_OUTPUT, { recursive: true, force: true })
    await writeFile(
      config,
      `${JSON.stringify(builderConfig(mode, identity, sourcePackage), null, 2)}\n`,
    )
    const args = [
      "--filter",
      "@switchback/desktop",
      "exec",
      "electron-builder",
      "--config",
      config,
      "--mac",
    ]
    if (options.directory) args.push("--dir")
    const env = options.signed
      ? process.env
      : { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" }
    await run("pnpm", args, env)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function argumentsOf(args) {
  const mode = args.find((arg) => ["full", "thin", "all"].includes(arg)) ?? "full"
  return {
    mode,
    directory: args.includes("--dir"),
    signed: args.includes("--signed"),
    print: args.includes("--print"),
  }
}

async function main() {
  const options = argumentsOf(process.argv.slice(2))
  const identity = buildIdentity()
  const sourcePackage = JSON.parse(await readFile(PACKAGE, "utf8"))
  const modes = options.mode === "all" ? ["full", "thin"] : [options.mode]
  if (options.print) {
    console.log(
      JSON.stringify(
        { identity, configs: modes.map((mode) => builderConfig(mode, identity, sourcePackage)) },
        null,
        2,
      ),
    )
    return
  }
  console.log(`构建 ${identity.version}+${identity.build}：${modes.join(" + ")}`)
  await run("pnpm", ["--filter", "@switchback/web", "run", "build"])
  await run("pnpm", ["--filter", "@switchback/desktop", "run", "build"])
  for (const mode of modes) await packageMode(mode, identity, sourcePackage, options)
  if (!options.directory)
    await run(process.execPath, [join(ROOT, "scripts/prune-release.mjs"), "--apply"])
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
