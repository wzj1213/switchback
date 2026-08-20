#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const LIMIT = 900

async function cssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return cssFiles(path)
      return entry.isFile() && entry.name.endsWith(".css") ? [path] : []
    }),
  )
  return nested.flat()
}

const files = (
  await Promise.all([
    cssFiles(join(ROOT, "apps/desktop/src")),
    cssFiles(join(ROOT, "apps/web/src")),
  ])
).flat()
const oversized = []
for (const file of files) {
  const lines = (await readFile(file, "utf8")).split("\n").length - 1
  if (lines > LIMIT) oversized.push(`${relative(ROOT, file)}：${String(lines)} 行`)
}

if (oversized.length > 0) {
  console.error([`CSS 单文件不得超过 ${String(LIMIT)} 行：`, ...oversized].join("\n"))
  process.exitCode = 1
} else {
  console.log(`✅ CSS 体积闸门：${String(files.length)} 个文件均 ≤ ${String(LIMIT)} 行`)
}
