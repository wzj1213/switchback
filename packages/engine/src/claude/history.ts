import { open, readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import type { EngineAccount, EngineThread, Item } from "@omni/protocol"
import { applyResult, assistantItems, toolResults, type ToolResult } from "./translate.js"

/**
 * Claude 存在磁盘上的会话：怎么列出来。
 *
 * ## 为什么是读文件而不是问 SDK
 *
 * Claude Code 把每次对话原样写在 `~/.claude/projects/<被转义的路径>/<sessionId>.jsonl`
 * ——这台机器上 128 个项目、1484 个文件。SDK 没有「列出历史会话」的接口，
 * 但**文件名就是 session id**，而那正是 `resume` 要的句柄。
 *
 * 比 codex 那边强的地方在于：这些文件里**有完整内容**。
 * codex 的 `thread/items/list` 回 `not supported yet`，所以接过来只能是空的；
 * 这边接过来能把对话真的摆出来（见 `toItems`）。
 *
 * ## 为什么只读文件头
 *
 * 列表只需要标题、工作区、时间。标题在文件开头（`custom-title` / `ai-title`），
 * 工作区每条消息上都有，时间用文件的 mtime 就够——
 * **为了列一行而把 1484 个文件整个读一遍是不能接受的**。
 */

/** 最多列几条。和界面上那一段的上限对齐（`sidebar.ts` 的 `FOREIGN_MAX`）。 */
const LIST_MAX = 40

/** 每个文件读多少字节来找标题和工作区。够覆盖开头那几行元数据。 */
const HEAD_BYTES = 64 * 1024

/**
 * **会话文件的文件名就是 session id，而 session id 是 UUID。**
 *
 * 同一个目录下还躺着别的东西：`agent-<hex>.jsonl` 是子 agent 的记录
 *（实测 1484 个文件里有 763 个是这个），`journal.jsonl` 是别的流水。
 * 它们都有 `cwd`、也都有内容，光看「是不是 jsonl」分不出来——
 * 而把一个子 agent 的 id 当句柄去 `resume`，引擎那边根本不认。
 */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface HeadInfo {
  title?: string
  cwd?: string
  /** 第一句用户消息。**标题的最后一道退路**——比「（没有标题）」有用得多。 */
  first?: string
}

/**
 * 列出 Claude 的历史会话，最近动过的在前。
 *
 * 取不到就给空数组——**不抛**。这是锦上添花的一段，
 * 一个读不了的目录不该让整个会话起不来。
 */
export async function listSessions(home: string): Promise<readonly EngineThread[]> {
  const root = join(home, ".claude", "projects")
  const files = await recentFiles(root)
  const out: EngineThread[] = []
  for (const file of files) {
    const head = await readHead(file.path).catch((): HeadInfo => ({}))
    // **没有工作区就不列。** 和 codex 那边同一条规则：工作区是所有写范围判定的
    // 真源，猜一个的代价是它在你没想到的目录里动手
    if (head.cwd === undefined) continue
    out.push({
      handle: file.id,
      // 人起的 > 自动总结的 > 第一句话。**三样都没有才认输**
      title: head.title ?? head.first ?? "（没有标题）",
      cwd: head.cwd,
      updatedAt: file.at,
    })
    if (out.length >= LIST_MAX) break
  }
  return out
}

/** 所有会话文件，按最后修改时间倒序。**用 mtime 不解析文件**——列表阶段够用了。 */
async function recentFiles(root: string): Promise<readonly { path: string; id: string; at: number }[]> {
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => [])
  const found: { path: string; id: string; at: number }[] = []
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const inner = join(root, dir.name)
    const names = await readdir(inner).catch((): string[] => [])
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue
      const id = name.slice(0, -".jsonl".length)
      if (!SESSION_ID.test(id)) continue
      const path = join(inner, name)
      const info = await stat(path).catch(() => undefined)
      // 空文件是开了没说话就退出的会话，接过来什么都没有
      if (info === undefined || info.size === 0) continue
      found.push({ path, id, at: info.mtimeMs })
    }
  }
  return found.sort((a, b) => b.at - a.at)
}

/**
 * 读文件开头，找标题和工作区。
 *
 * 标题有两种：`custom-title` 是人自己起的，`ai-title` 是自动总结的。
 * **人起的优先**——和会话行的规则一致（见 `Thread.named`）。
 */
async function readHead(path: string): Promise<HeadInfo> {
  const handle = await open(path, "r")
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0)
    return scanHead(buf.subarray(0, bytesRead).toString("utf8"))
  } finally {
    await handle.close()
  }
}

/**
 * 从一段文本里挑出标题和工作区。**纯函数**，所以能直接拿真实片段测。
 *
 * 最后一行大概率被截断（我们只读了固定字节数），解析失败就跳过——
 * 这正是 `JSON.parse` 包在 try 里的原因，不是防御性编程的惯性。
 */
export function scanHead(text: string): HeadInfo {
  const out: HeadInfo = {}
  let aiTitle: string | undefined
  for (const line of text.split("\n")) {
    const entry = parseLine(line)
    if (entry === undefined) continue
    out.title ??= strField(entry, "customTitle")
    aiTitle ??= strField(entry, "aiTitle")
    out.cwd ??= strField(entry, "cwd")
    out.first ??= firstAsk(entry)
    // 齐了就不往下读了。`first` 不算——它只是退路，为它多读半个文件不值
    if (out.title !== undefined && out.cwd !== undefined) break
  }
  // 人起的名字优先；没有才用自动总结的
  out.title ??= aiTitle
  return out
}

/**
 * 一行 JSON。**解析不了就跳过**——我们只读了固定字节数，
 * 最后一行大概率是断的。这不是防御性编程的惯性，是这个读法的必然结果。
 */
function parseLine(line: string): Record<string, unknown> | undefined {
  if (line.trim() === "") return undefined
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** 取一个非空字符串字段。空串当作没有——它和缺席对界面是同一件事。 */
function strField(entry: Record<string, unknown>, key: string): string | undefined {
  const value = entry[key]
  return typeof value === "string" && value !== "" ? value : undefined
}

/**
 * 一条 `user` 记录里那句人话，用来兜底当标题。
 *
 * **只认字符串形式的 content**：块数组那种要么是工具结果、要么是贴进来的图，
 * 都不是「这段对话是干什么的」。取第一行、截短——preview 里常有整段代码。
 */
function firstAsk(entry: Record<string, unknown>): string | undefined {
  if (entry["type"] !== "user" || entry["isSidechain"] === true) return undefined
  const message = entry["message"]
  if (typeof message !== "object" || message === null) return undefined
  const content = (message as { content?: unknown }).content
  if (typeof content !== "string") return undefined
  // 续跑注入的那段摘要不是人打的，拿它当标题每条都长一样
  if (content.startsWith("This session is being continued")) return undefined
  const line = content.split("\n").find((l) => l.trim() !== "")?.trim()
  if (line === undefined || line === "") return undefined
  return line.length > 60 ? `${line.slice(0, 60)}…` : line
}

/** 会话文件的绝对路径。`listSessions` 只交出 id，读全文时要靠这个找回来。 */
export async function findSession(home: string, id: string): Promise<string | undefined> {
  const root = join(home, ".claude", "projects")
  const dirs = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const path = join(root, dir.name, `${id}.jsonl`)
    const info = await stat(path).catch(() => undefined)
    if (info !== undefined) return path
  }
  return undefined
}

/** 读全文，一行一条。解析不了的行跳过——一条坏行不该毁掉整段历史。 */
export async function readEntries(path: string): Promise<readonly Record<string, unknown>[]> {
  const text = await readFile(path, "utf8").catch(() => "")
  const out: Record<string, unknown>[] = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    try {
      out.push(JSON.parse(line) as Record<string, unknown>)
    } catch {
      continue
    }
  }
  return out
}

/**
 * 一条存在磁盘上的会话 → omni 的 transcript。
 *
 * ## 为什么这件事值得做
 *
 * codex 那边接过来只能是空的（`thread/items/list` 回 `not supported yet`），
 * 于是界面上要专门写一句「内容在引擎那边」。Claude 这边**文件里就是全文**，
 * 所以能真的摆出来——接过来看到的和你当初在终端里看到的是同一段对话。
 *
 * ## 翻译是复用的，不是另写一份
 *
 * 存盘的 `message.content` 就是 Anthropic 的内容块，和 SDK 实时推的一模一样，
 * 所以直接过 `assistantItems` / `toolResults` / `applyResult`。
 * 另写一份的下场是：哪天工具详情的呈现改了，只有实时那条路被改到，
 * 而历史这条路悄悄和它长得不一样。
 *
 * ## 跳掉的几类
 *
 * - `isSidechain`：子 agent 的往来。那是**另一段对话**，混进主线只会让人
 *   以为它自言自语。
 * - `isCompactSummary`：压缩上下文时注入的那段摘要。它不是人打的，
 *   摆成用户消息会看到一条几千字的「自己说的话」。
 * - `isMeta` / 各类元数据行（标题、模式、队列）：它们不是对话内容。
 */
export function toItems(entries: readonly Record<string, unknown>[], now: number): readonly Item[] {
  const out: Item[] = []
  const byId = new Map<string, number>()
  const seq = { n: 0 }
  const turn = { id: "h-t0" }
  const nextId = (): string => `h-i${String(++seq.n)}`
  for (const entry of entries) {
    if (skip(entry)) continue
    const content = contentOf(entry)
    if (content === undefined) continue
    const at = timeOf(entry["timestamp"]) ?? now
    if (entry["type"] === "user") takeUser(out, byId, content, { at, seq, turn, nextId })
    else if (entry["type"] === "assistant" && Array.isArray(content)) {
      takeAssistant(out, byId, content, { turnId: turn.id, at, nextId })
    }
  }
  return out
}

/** 这一条要不要看。三类跳过的理由见 `toItems` 的说明。 */
function skip(entry: Record<string, unknown>): boolean {
  return entry["isSidechain"] === true || entry["isMeta"] === true || entry["isCompactSummary"] === true
}

/** `message.content`。不是对话消息的行没有它。 */
function contentOf(entry: Record<string, unknown>): unknown {
  const message = entry["message"]
  if (typeof message !== "object" || message === null) return undefined
  return (message as { content?: unknown }).content
}

interface Cursor {
  at: number
  /** id 计数器。**装在对象里传**，不然各处各拿一份就会撞号。 */
  seq: { n: number }
  /** 当前轮次。每句人话开一轮。 */
  turn: { id: string }
  nextId: () => string
}

/**
 * 一条 user 记录。两种形态：字符串是人打的话（开新一轮），
 * 块数组是工具结果（并回对应的调用）。
 */
function takeUser(out: Item[], byId: Map<string, number>, content: unknown, cur: Cursor): void {
  if (Array.isArray(content)) {
    applyResults(out, byId, toolResults(content))
    return
  }
  if (typeof content !== "string" || content.trim() === "") return
  cur.turn.id = `h-t${String(++cur.seq.n)}`
  out.push({
    id: cur.nextId(),
    turnId: cur.turn.id,
    kind: "user_message",
    at: cur.at,
    text: content,
    complete: true,
  } as Item)
}

/** 一条 assistant 记录。工具调用要记下位置，等它的结果回来时并进去。 */
function takeAssistant(
  out: Item[],
  byId: Map<string, number>,
  content: readonly unknown[],
  ctx: { turnId: string; at: number; nextId: () => string },
): void {
  for (const item of assistantItems(content, ctx)) {
    if (item.kind === "tool_call") byId.set(item.id, out.length)
    out.push(item)
  }
}

/** 把工具结果并回它对应的那次调用。找不到就丢——那次调用不在这段历史里。 */
function applyResults(
  out: Item[],
  byId: Map<string, number>,
  results: readonly ToolResult[],
): void {
  for (const result of results) {
    const at = byId.get(result.toolUseId)
    if (at === undefined) continue
    const item = out[at]
    if (item?.kind !== "tool_call") continue
    out[at] = applyResult(item, result)
  }
}

/** ISO 字符串 → 毫秒。认不出就 undefined，调用方回落到「现在」。 */
function timeOf(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined
  const at = new Date(raw).getTime()
  return Number.isNaN(at) ? undefined : at
}

/**
 * 一条会话最多搬多少条进 omni。
 *
 * 不设上限的话，接一条大会话等于**把它原样复制一份到 omni 的日志里**——
 * 实测最大的一条 56.6MB / 3580 条 item，接十条就是半个 G。
 *
 * 留的是**尾巴**（最近的）：一条对话你回头要接着说的时候，
 * 需要看见的是刚才在做什么，不是它开头怎么起的。
 */
const ITEM_MAX = 1500

export interface Transcript {
  items: readonly Item[]
  /** 原本有多少条。大于 `items.length` 就是截断过——**调用方必须说出来**。 */
  total: number
}

/** 读一条会话的全文并翻成 items。找不到文件就给空的。 */
export async function readTranscript(home: string, id: string, now: number): Promise<Transcript> {
  const path = await findSession(home, id)
  if (path === undefined) return { items: [], total: 0 }
  const all = toItems(await readEntries(path), now)
  return { items: all.length > ITEM_MAX ? all.slice(-ITEM_MAX) : all, total: all.length }
}

/**
 * 登录的是哪个账号。
 *
 * 读 `~/.claude.json` 里的 `oauthAccount`——**只取身份，不碰凭据**：
 * 那个对象里没有 token（凭据在别处），这里也只挑名字、邮箱、套餐三样。
 *
 * 名字优先于邮箱：codex 那边界面上写的也是人名（截图里是「messi leo」），
 * 而一串 `a1b2c3d4e5@privaterelay.appleid.com` 在侧栏那一行里既认不出人、
 * 又长到要截断。
 */
export async function readAccount(home: string): Promise<EngineAccount | undefined> {
  const text = await readFile(join(home, ".claude.json"), "utf8").catch(() => "")
  return parseAccount(text)
}

/** 纯的那一半，好直接拿真实片段测。读不懂就 undefined，界面据此不画。 */
export function parseAccount(text: string): EngineAccount | undefined {
  if (text === "") return undefined
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return undefined
  }
  const account = (raw as { oauthAccount?: Record<string, unknown> } | null)?.oauthAccount
  if (account === undefined) return undefined
  const label = pickStr(account, "displayName") ?? pickStr(account, "emailAddress")
  if (label === undefined) return undefined
  const plan = pickStr(account, "organizationType")
  return { label, ...(plan === undefined ? {} : { plan }) }
}

/** 取一个非空字符串字段。空串当没有——它和缺席对界面是同一件事。 */
function pickStr(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key]
  return typeof v === "string" && v !== "" ? v : undefined
}
