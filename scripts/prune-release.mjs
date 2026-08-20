#!/usr/bin/env node
import { readdir, rm, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const RELEASE = join(ROOT, "release")
const KEEP = 3
const ARTIFACT = /^omni-.+\.(?:dmg|zip|AppImage|tar\.gz)(?:\.blockmap)?$/u

function artifactKey(name) {
  return name.endsWith(".blockmap") ? name.slice(0, -".blockmap".length) : name
}

async function groups() {
  const entries = await readdir(RELEASE, { withFileTypes: true }).catch(() => [])
  const files = entries.filter((entry) => entry.isFile() && ARTIFACT.test(entry.name))
  const details = await Promise.all(
    files.map(async (entry) => ({
      name: entry.name,
      key: artifactKey(entry.name),
      at: (await stat(join(RELEASE, entry.name))).mtimeMs,
    })),
  )
  const byKey = new Map()
  for (const item of details) {
    const group = byKey.get(item.key) ?? { key: item.key, at: 0, files: [] }
    group.at = Math.max(group.at, item.at)
    group.files.push(item.name)
    byKey.set(item.key, group)
  }
  return [...byKey.values()].sort((left, right) => right.at - left.at)
}

async function main() {
  const all = await groups()
  const old = all.slice(KEEP)
  if (old.length === 0) {
    console.log(`release 已在保留范围内（${String(all.length)}/${String(KEEP)} 组）`)
    return
  }
  const files = old.flatMap((group) => group.files).sort()
  if (!process.argv.includes("--apply")) {
    console.log([`将保留最新 ${String(KEEP)} 组，以下仅预览：`, ...files].join("\n"))
    return
  }
  await Promise.all(files.map((name) => rm(join(RELEASE, name), { force: true })))
  console.log(`已清理 ${String(files.length)} 个旧发行文件，保留最新 ${String(KEEP)} 组。`)
}

await main()
