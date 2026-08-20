import { readFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * Kimi 原始会话记录在磁盘上的位置。
 *
 * Web API 能给 omni 一份结构化 transcript，但跨引擎接力要的是引擎自己保存的
 * 全量原文。它位于 `agents/main/wire.jsonl`；工作区目录名含 Kimi 私有哈希，
 * 所以只查 Kimi 自己维护的索引，不在 omni 里复刻路径算法。
 */
const WIRE = join("agents", "main", "wire.jsonl")

interface IndexRow {
  sessionId: string
  sessionDir: string
}

/** 坏行当不存在：索引由另一个进程追加，末行可能正写到一半。 */
function parseRow(line: string): IndexRow | undefined {
  try {
    const raw: unknown = JSON.parse(line)
    if (typeof raw !== "object" || raw === null) return undefined
    const row = raw as Record<string, unknown>
    if (typeof row.sessionId !== "string" || typeof row.sessionDir !== "string") return undefined
    return { sessionId: row.sessionId, sessionDir: row.sessionDir }
  } catch {
    return undefined
  }
}

/** 重复 id 取最后一条：追加索引里后写的记录才是当前记录。 */
export function findInIndex(text: string, sessionId: string): string | undefined {
  const lines = text.split("\n")
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const row = parseRow(lines[index] ?? "")
    if (row?.sessionId === sessionId) return row.sessionDir
  }
  return undefined
}

/** home 由宿主显式传入，不在驱动里读环境变量。 */
export async function kimiLogPath(home: string, sessionId: string): Promise<string | undefined> {
  const text = await readFile(join(home, ".kimi-code", "session_index.jsonl"), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  const dir = findInIndex(text, sessionId)
  return dir === undefined ? undefined : join(dir, WIRE)
}
