import { readFile, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { ipcMain, app } from "electron"
import type { ContentHit, SearchOut } from "../shared/search.js"

/**
 * 在**所有会话的正文里**找一句话。
 *
 * ## 它治的是什么
 *
 * 侧栏那个筛选框只搜三样：标题、第一条消息、目录（见 `renderer/filter.ts`）。
 * 而人记得住的往往是中间某一句——「它说要改成流式的那次」「我让它别再用 any 那回」。
 * 那句话就在盘上，`~/Library/Application Support/omni/threads/*.jsonl` 一行一条，
 * 但**没有任何入口能读到它**：会话不在文件管理器里、不在浏览器历史里，找不到等于没有。
 *
 * ## 只搜「说过的话」，不搜工具调用
 *
 * `tool_call` 的 detail 里是命令原文和补丁。把它算进来的话，搜 `review` 会命中
 * 每一条跑过 `git diff` 的记录——**噪音会把真正想找的那句埋掉**。
 * 人记得住的是对话，不是它当时敲了哪条命令。这条边界写在这里，也写在界面上。
 *
 * ## 为什么敢直接读整个文件
 *
 * 因为有预筛：先在**原始那行文本**里找关键词（JSON 不转义非 ASCII，中文原样在里面），
 * 命中了才 `JSON.parse`。解析才是贵的那一步，而绝大多数行一个词都不含。
 * 再加上「按新到旧扫 + 字节预算」两道闸，最坏情况有上界。
 */

/** 扫多少字节就收手。5 MB 的历史大约 0.1 秒，这个上限对应最坏 ~1 秒。 */
const BUDGET = 48 * 1024 * 1024
/** 一条摘要留多长。太短看不出上下文，太长把侧栏撑破。 */
const SNIP = 140
/** 最多回多少条会话。人扫不完更多，而每多一条都要渲染。 */
const MAX_HITS = 40

export function termsOf(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t !== "")
}

/**
 * 摘要：**以第一个命中的词为中心截一段**，不是从头截。
 *
 * 从头截的话，一条五百字的回答里那个词多半根本不在截出来的那段里——
 * 搜索结果看起来就像随机摘的句子，没法判断是不是要找的那条。
 */
export function snippetOf(text: string, terms: readonly string[]): string {
  const flat = text.replace(/\s+/g, " ").trim()
  const low = flat.toLowerCase()
  const at = terms.map((t) => low.indexOf(t)).filter((i) => i >= 0)
  if (flat.length <= SNIP) return flat
  const first = at.length === 0 ? 0 : Math.min(...at)
  const start = Math.max(0, first - 40)
  const cut = flat.slice(start, start + SNIP)
  return `${start > 0 ? "…" : ""}${cut}${start + SNIP < flat.length ? "…" : ""}`
}

interface Msg {
  text: string
  at: number
}

/** 一行 jsonl → 「这是一条谁说的话吗」。工具行、状态行一律返回 undefined。 */
function messageOf(line: string): Msg | undefined {
  let event: unknown
  try {
    event = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof event !== "object" || event === null) return undefined
  const rec = event as { type?: string; item?: { kind?: string; text?: string; at?: number } }
  if (rec.type !== "item.started" && rec.type !== "item.updated") return undefined
  const item = rec.item
  if (item === undefined) return undefined
  if (item.kind !== "user_message" && item.kind !== "agent_message") return undefined
  return typeof item.text === "string" && item.text !== "" ? { text: item.text, at: item.at ?? 0 } : undefined
}

/**
 * 扫一个会话文件。
 *
 * **入选的条件是「每个词都出现过」，但不必在同一条消息里**——
 * 「omni 流式」找的是「在 omni 那条会话里聊过流式」，那两个词多半分散在不同轮次。
 * 按「同一条消息里全中」筛的话，多词查询几乎永远是空的。
 */
export function scanLines(lines: readonly string[], terms: readonly string[]): Omit<ContentHit, "threadId"> | undefined {
  const seen = new Set<string>()
  const best = { score: 0, snippet: "", at: 0 }
  let count = 0
  for (const line of lines) {
    const low = line.toLowerCase()
    // 预筛：整行原文里一个词都没有就不解析。解析才是贵的那一步
    if (!terms.some((t) => low.includes(t))) continue
    const msg = messageOf(line)
    if (msg === undefined) continue
    const text = msg.text.toLowerCase()
    const hit = terms.filter((t) => text.includes(t))
    if (hit.length === 0) continue
    count += 1
    for (const t of hit) seen.add(t)
    if (hit.length > best.score) {
      best.score = hit.length
      best.snippet = snippetOf(msg.text, terms)
      best.at = msg.at
    }
  }
  if (seen.size < terms.length) return undefined
  return { count, snippet: best.snippet, at: best.at }
}

/** `th-xxx.jsonl` → `th-xxx`。别的文件不是会话记录。 */
function threadIdOf(name: string): string | undefined {
  return name.startsWith("th-") && name.endsWith(".jsonl") ? name.slice(0, -".jsonl".length) : undefined
}

export async function searchThreads(dir: string, query: string): Promise<SearchOut> {
  const terms = termsOf(query)
  if (terms.length === 0) return { hits: [], skipped: 0 }
  const names = await readdir(dir).catch(() => [] as string[])
  const files = (
    await Promise.all(
      names.map(async (name) => {
        const id = threadIdOf(name)
        if (id === undefined) return undefined
        const info = await stat(join(dir, name)).catch(() => undefined)
        return info === undefined ? undefined : { id, path: join(dir, name), size: info.size, mtime: info.mtimeMs }
      }),
    )
  ).filter((f): f is NonNullable<typeof f> => f !== undefined)
  // **新的先扫**：预算用完时留下的是最旧的那几个，而人找的多半是最近聊过的
  files.sort((a, b) => b.mtime - a.mtime)
  const hits: ContentHit[] = []
  let spent = 0
  let skipped = 0
  for (const file of files) {
    if (spent > BUDGET) {
      skipped += 1
      continue
    }
    spent += file.size
    const raw = await readFile(file.path, "utf8").catch(() => "")
    const found = scanLines(raw.split("\n"), terms)
    if (found !== undefined) hits.push({ threadId: file.id, ...found })
  }
  hits.sort((a, b) => b.at - a.at)
  return { hits: hits.slice(0, MAX_HITS), skipped }
}

export function installSearchChannel(): void {
  const dir = join(app.getPath("userData"), "threads")
  ipcMain.handle("omni:searchThreads", async (_e, query: string) =>
    typeof query === "string" ? searchThreads(dir, query) : { hits: [], skipped: 0 },
  )
}
