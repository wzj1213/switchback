import { open, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { EngineAccount, EngineThread, Item } from "@switchback/protocol"
import { applyResult, assistantItems, toolResults, type ToolResult } from "./translate.js"
import { findSessionFile, recentSessionFiles } from "./history-files.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { CLAUDE_HISTORY } from "./history.messages.js"

/**
 * Claude 存在磁盘上的会话：怎么列出来。
 *
 * ## 为什么是读文件而不是问 SDK
 *
 * Claude Code 把每次对话原样写在 `~/.claude/projects/<被转义的路径>/<sessionId>.jsonl`
 * ——这台机器上 128 个项目、1484 个文件。SDK 没有「列出历史会话」的接口，
 * 但**文件名就是 session id**，而那正是 `resume` 要的句柄。
 *
 * 这些文件里也有完整内容，所以接管时能把对话真的摆出来（见 `toItems`）。
 * 这条载体是本地 jsonl；其他引擎可能从 resume 回包或历史 API 给出正文。
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
const HEAD_BATCH = 12

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
export async function listSessions(home: string, locale: Locale = DEFAULT_LOCALE): Promise<readonly EngineThread[]> {
  const files = await recentSessionFiles(home)
  const out: EngineThread[] = []
  for (let offset = 0; offset < files.length && out.length < LIST_MAX; offset += HEAD_BATCH) {
    const batch = files.slice(offset, offset + HEAD_BATCH)
    const heads = await Promise.all(batch.map((file) => readHead(file.path).catch((): HeadInfo => ({}))))
    for (const [index, head] of heads.entries()) {
      const file = batch[index]
      // **没有工作区就不列。** 工作区是所有写范围判定的真源，不能猜。
      if (file === undefined || head.cwd === undefined) continue
      out.push({
        handle: file.id,
        title: head.title ?? head.first ?? CLAUDE_HISTORY[locale].untitled,
        cwd: head.cwd,
        updatedAt: file.at,
      })
      if (out.length >= LIST_MAX) break
    }
  }
  return out
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
  return findSessionFile(home, id)
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
 * 一条存在磁盘上的会话 → Switchback 的 transcript。
 *
 * ## 为什么这件事值得做
 *
 * Claude 的文件里就是全文，所以能真的摆出来——接过来看到的和你当初在
 * 终端里看到的是同一段对话。翻译不依赖其他引擎采用哪种历史载体。
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
export function toItems(entries: readonly Record<string, unknown>[], now: number, locale: Locale = DEFAULT_LOCALE): readonly Item[] {
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
    if (entry["type"] === "user") takeUser(out, byId, content, { at, seq, turn, nextId, locale })
    else if (entry["type"] === "assistant" && Array.isArray(content)) {
      takeAssistant(out, byId, content, { turnId: turn.id, at, nextId, locale })
    }
  }
  return out
}

/**
 * 这一条是不是**一句人话**——也就是一轮的开头。
 *
 * 分叉要按「轮」往回数（`fork.ts`），而「轮」在这个文件格式里没有显式标记，
 * 唯一的边界就是「用户又说了一句」。所以判据必须和 `toItems` 里开新轮那处**一模一样**，
 * 两处各写一份的话，分叉点会和界面上看到的轮次对不上——而那种错不会报错，
 * 只会让你少带或多带一轮上下文。
 *
 * `tool_result` 也是 `type: "user"`，但它不是人打的，不开轮。
 */
export function humanTurn(entry: Record<string, unknown>): boolean {
  if (skip(entry) || entry["type"] !== "user") return false
  const content = contentOf(entry)
  if (Array.isArray(content) && toolResults(content).length > 0) return false
  return userText(content) !== undefined
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
  locale: Locale
}

/**
 * 一条 user 记录。两种形态：字符串是人打的话（开新一轮），
 * 块数组是工具结果（并回对应的调用）。
 */
function takeUser(out: Item[], byId: Map<string, number>, content: unknown, cur: Cursor): void {
  if (Array.isArray(content)) {
    const results = toolResults(content)
    if (results.length > 0) {
      applyResults(out, byId, results, cur.locale)
      return
    }
  }
  const text = userText(content)
  if (text === undefined) return
  cur.turn.id = `h-t${String(++cur.seq.n)}`
  out.push({
    id: cur.nextId(),
    turnId: cur.turn.id,
    kind: "user_message",
    at: cur.at,
    text,
    complete: true,
  } as Item)
}

/** 图片提问落盘后是 `[image, text]`；只取其中的人话，不把图片元数据拼进正文。 */
function userText(content: unknown): string | undefined {
  if (typeof content === "string") return content.trim() === "" ? undefined : content
  if (!Array.isArray(content)) return undefined
  const text = content
    .flatMap((block) => {
      if (typeof block !== "object" || block === null) return []
      const raw = block as { type?: unknown; text?: unknown }
      return raw.type === "text" && typeof raw.text === "string" ? [raw.text] : []
    })
    .join("\n")
  return text.trim() === "" ? undefined : text
}

/** 一条 assistant 记录。工具调用要记下位置，等它的结果回来时并进去。 */
function takeAssistant(
  out: Item[],
  byId: Map<string, number>,
  content: readonly unknown[],
  ctx: { turnId: string; at: number; nextId: () => string; locale: Locale },
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
  locale: Locale,
): void {
  for (const result of results) {
    const at = byId.get(result.toolUseId)
    if (at === undefined) continue
    const item = out[at]
    if (item?.kind !== "tool_call") continue
    out[at] = applyResult(item, result, locale)
  }
}

/** ISO 字符串 → 毫秒。认不出就 undefined，调用方回落到「现在」。 */
function timeOf(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined
  const at = new Date(raw).getTime()
  return Number.isNaN(at) ? undefined : at
}

/**
 * 一条会话最多搬多少条进 Switchback。
 *
 * 不设上限的话，接一条大会话等于**把它原样复制一份到 Switchback 的日志里**——
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
export async function readTranscript(home: string, id: string, now: number, locale: Locale = DEFAULT_LOCALE): Promise<Transcript> {
  const path = await findSession(home, id)
  if (path === undefined) return { items: [], total: 0 }
  const all = toItems(await readEntries(path), now, locale)
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
