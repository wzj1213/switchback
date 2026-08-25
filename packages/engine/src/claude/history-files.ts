import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"

/** 子 agent 也有 jsonl；只有 UUID 文件名才是 Claude `resume` 接受的主会话。 */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAT_BATCH = 64

export interface SessionFile {
  path: string
  id: string
  at: number
}

interface Candidate {
  path: string
  id: string
}

async function projectDirs(home: string): Promise<readonly string[]> {
  const root = join(home, ".claude", "projects")
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name))
}

async function candidatesOf(dirs: readonly string[]): Promise<readonly Candidate[]> {
  const groups = await Promise.all(dirs.map(async (dir) => {
    const names = await readdir(dir).catch((): string[] => [])
    return names.flatMap((name) => {
      if (!name.endsWith(".jsonl")) return []
      const id = name.slice(0, -".jsonl".length)
      return SESSION_ID.test(id) ? [{ path: join(dir, name), id }] : []
    })
  }))
  return groups.flat()
}

async function existing(candidates: readonly Candidate[]): Promise<readonly SessionFile[]> {
  const found: SessionFile[] = []
  for (let offset = 0; offset < candidates.length; offset += STAT_BATCH) {
    const rows = await Promise.all(candidates.slice(offset, offset + STAT_BATCH).map(async (candidate) => {
      const info = await stat(candidate.path).catch(() => undefined)
      return info === undefined || info.size === 0
        ? undefined
        : { ...candidate, at: info.mtimeMs }
    }))
    found.push(...rows.filter((row): row is SessionFile => row !== undefined))
  }
  return found
}

/** 并发枚举项目目录，并以小批量 stat，避免上千条会话逐文件串行等待。 */
export async function recentSessionFiles(home: string): Promise<readonly SessionFile[]> {
  const candidates = await candidatesOf(await projectDirs(home))
  return [...(await existing(candidates))].sort((a, b) => b.at - a.at)
}

export async function findSessionFile(home: string, id: string): Promise<string | undefined> {
  if (!SESSION_ID.test(id)) return undefined
  const paths = (await projectDirs(home)).map((dir) => join(dir, `${id}.jsonl`))
  const found = await Promise.all(paths.map(async (path) => {
    const info = await stat(path).catch(() => undefined)
    return info === undefined ? undefined : path
  }))
  return found.find((path) => path !== undefined)
}
