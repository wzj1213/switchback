import { isAbsolute, join, relative, resolve, sep } from "node:path"
import type { ReviewFile } from "../shared/review.js"

interface BaselineLocation { root: string; cwd: string }
interface NamedEntry { rel: string; from?: string }

export interface BaselineNameEntry extends NamedEntry { mark: string }

export function baselineNameEntries(raw: string): readonly BaselineNameEntry[] {
  const parts = raw.split("\0")
  const out: BaselineNameEntry[] = []
  for (let index = 0; index < parts.length; index += 1) {
    const mark = parts[index]
    if (mark === undefined || mark === "") continue
    if (mark.startsWith("R") || mark.startsWith("C")) {
      const from = parts[index + 1], rel = parts[index + 2]
      if (from !== undefined && rel !== undefined) out.push({ mark, from, rel })
      index += 2
      continue
    }
    const rel = parts[index + 1]
    if (rel !== undefined) out.push({ mark, rel })
    index += 1
  }
  return out
}

export function baselineKind(mark: string, currentCode?: string): ReviewFile["kind"] {
  if (mark.startsWith("A") && currentCode?.startsWith("?") === true) return "untracked"
  if (mark.startsWith("A")) return "add"
  if (mark.startsWith("D")) return "delete"
  if (mark.startsWith("R") || mark.startsWith("C")) return "rename"
  return "update"
}

function within(root: string, path: string): string | undefined {
  const rel = relative(root, path)
  return rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)
    ? undefined
    : rel
}

function tmpAlias(path: string): string {
  if (path === "/tmp") return "/private/tmp"
  return path.startsWith("/tmp/") ? `/private${path}` : path
}

export function wantedBaselineRel(
  path: string,
  requestedCwd: string,
  meta: BaselineLocation,
): string | undefined {
  const insideRepo = (rel: string): string | undefined =>
    rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)
      ? undefined
      : rel
  if (!isAbsolute(path)) return insideRepo(join(relative(meta.root, meta.cwd), path))
  const lexical = within(tmpAlias(resolve(requestedCwd)), tmpAlias(resolve(path)))
  if (lexical !== undefined) return insideRepo(join(relative(meta.root, meta.cwd), lexical))
  return within(tmpAlias(meta.root), tmpAlias(resolve(path)))
}

export function selectBaselineEntries<T extends NamedEntry>(
  all: readonly T[],
  wanted: ReadonlySet<string>,
  maximum: number,
): readonly T[] {
  const first = all.slice(0, maximum)
  const seen = new Set(first.map((entry) => entry.rel))
  return [...first, ...all.filter((entry) => !seen.has(entry.rel) &&
    (wanted.has(entry.rel) || (entry.from !== undefined && wanted.has(entry.from))))]
}
