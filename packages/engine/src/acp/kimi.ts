import { readFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * kimi 的会话记录在磁盘上的哪儿。
 *
 * ## 为什么这一段是引擎私有的，不做进 ACP 驱动
 *
 * ACP 协议里**没有「记录在哪」这个概念**——它只管开会话、发提示、收更新。
 * 所以每家 ACP 引擎往哪写、写成什么样，只能一家一家去认。
 * 认不出来的（比如 `engines.json` 里用户自己加的那些）就给 undefined，
 * 换引擎时退回交接包——那条路一直留着，见 `contract.ts` 的 `logPath`。
 *
 * ## 为什么要读它自己的索引，不自己拼路径
 *
 * 记录躺在
 * `~/.kimi-code/sessions/<工作区段>/<sessionId>/agents/main/wire.jsonl`，
 * 而**工作区那一段是 kimi 自己算的**（实测形如 `wd_omni_0123456789ab`：
 * 目录名 + 一串哈希）。哈希怎么算是它的内部约定，猜出来的东西下个版本就错。
 *
 * 它自己维护着 `~/.kimi-code/session_index.jsonl`，每行一条
 * `{sessionId, sessionDir, workDir}`——直接查这张表，路径由它给。
 *
 * 好消息是 id 不用翻译：ACP 那边报上来的 session id 和索引里的 `sessionId`
 * **一字不差**（实测都是 `session_00000000-0000-4000-8000-000000000000` 这种）。
 */

/** kimi 把「和模型之间的全部往来」原样写在这个文件里，包括系统提示与每一轮。 */
const WIRE = join("agents", "main", "wire.jsonl")

interface IndexRow {
  sessionId: string
  sessionDir: string
}

/**
 * 一行索引。**坏行当不存在**：这个文件是别的进程在追加写的，
 * 读到一半的一行完全可能出现，而为此整份索引不可用是不划算的。
 */
function parseRow(line: string): IndexRow | undefined {
  try {
    const raw: unknown = JSON.parse(line)
    if (typeof raw !== "object" || raw === null) return undefined
    const it = raw as Record<string, unknown>
    if (typeof it.sessionId !== "string" || typeof it.sessionDir !== "string") return undefined
    return { sessionId: it.sessionId, sessionDir: it.sessionDir }
  } catch {
    return undefined
  }
}

/**
 * 在索引里找这条会话的目录。
 *
 * **从后往前找**：同一个 sessionId 理论上只有一条，但索引是追加写的，
 * 真有重复时后写的那条才是现在有效的。
 */
export function findInIndex(text: string, sessionId: string): string | undefined {
  const lines = text.split("\n")
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const row = parseRow(lines[i] ?? "")
    if (row !== undefined && row.sessionId === sessionId) return row.sessionDir
  }
  return undefined
}

/**
 * @param home 用户 home 绝对路径。由 `StartRequest.home` 传进来，不读环境变量——
 *   和 `approval` 那边同一个理由：读环境的东西没法在测试里摆布。
 */
export async function kimiLogPath(home: string, sessionId: string): Promise<string | undefined> {
  const text = await readFile(join(home, ".kimi-code", "session_index.jsonl"), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  const dir = findInIndex(text, sessionId)
  return dir === undefined ? undefined : join(dir, WIRE)
}
