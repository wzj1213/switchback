import type { SlashCommand } from "@switchback/protocol"

/**
 * 输入框里没发出去的话，落在本机的那一份（主进程写 `drafts.json`，渲染层读）。
 *
 * 形状和渲染层 `composer-drafts.ts` 的 `ComposerDraftMemory` 一一对应，另外两样：
 * 已经并进来的宿主草稿是哪一版（`applied`），和最后一次写的时刻（`at`，淘汰用）。
 */

/** 输入框上方那排芯片。和渲染层 `composer-blocks.ts` 的 `DraftBlock` 同形。 */
export type StoredBlock =
  | { id: string; kind: "file"; path: string }
  | { id: string; kind: "paste"; text: string; label?: string }

export interface StoredDraft {
  engine: string
  text: string
  /** 只存路径：图在数据目录的 `attachments/` 里，孤儿清理认这份引用（见 main `drafts.ts`）。 */
  attachments: readonly string[]
  blocks: readonly StoredBlock[]
  command?: SlashCommand
  aside: boolean
  /**
   * 宿主交回输入框的草稿（取回、接不回退回）并过的是哪一版。**和正文存在同一条里**：
   * 分开存的话，重启后正文里已经有取回的那句、宿主那份还没被发送消费掉，就会再并一遍。
   */
  applied?: string
  at: number
}

/** 主进程读盘时交给渲染层的那一份。 */
export interface LoadedDrafts {
  drafts: Readonly<Record<string, StoredDraft>>
  /** 读盘时发现已经不在了的附件数，按草稿分。输入框据此说一声，不悄悄去掉。 */
  missing: Readonly<Record<string, number>>
}

/**
 * 「新会话」那一格。点「+」和启动时自动开的那条是临时会话，id 重启后会变，按 id 存就再也找不回来；
 * 它们共用这一格，发出第一句就清掉。分叉、重来出来的临时会话不用它（见渲染层 `composer-drafts.ts`）。
 */
export const NEW_DRAFT = "new"

/** 留最近这么多份。**不按时间过期**：过期删掉的，往往正是人回头要找的那一段。 */
export const MAX_DRAFTS = 50

/** 什么都没有：不值得存。只记着「并过哪一版宿主草稿」的也要存，不然重启后删掉的字又回来了。 */
export function blankDraft(draft: Omit<StoredDraft, "at" | "engine">): boolean {
  return draft.text === "" && draft.attachments.length === 0 && draft.blocks.length === 0 &&
    draft.command === undefined && !draft.aside && draft.applied === undefined
}

const isString = (value: unknown): value is string => typeof value === "string"

function block(raw: unknown): StoredBlock | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const it = raw as Record<string, unknown>
  if (!isString(it["id"])) return undefined
  if (it["kind"] === "file" && isString(it["path"])) return { id: it["id"], kind: "file", path: it["path"] }
  if (it["kind"] !== "paste" || !isString(it["text"])) return undefined
  return { id: it["id"], kind: "paste", text: it["text"], ...(isString(it["label"]) ? { label: it["label"] } : {}) }
}

function command(raw: unknown): SlashCommand | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const it = raw as Record<string, unknown>
  return isString(it["name"]) && isString(it["description"]) ? (raw as SlashCommand) : undefined
}

function draft(raw: unknown): StoredDraft | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const it = raw as Record<string, unknown>
  if (!isString(it["engine"]) || !isString(it["text"]) || typeof it["at"] !== "number") return undefined
  const attachments = Array.isArray(it["attachments"]) ? it["attachments"].filter(isString) : []
  const blocks = Array.isArray(it["blocks"]) ? it["blocks"].flatMap((one) => block(one) ?? []) : []
  const slash = command(it["command"])
  return {
    engine: it["engine"], text: it["text"], attachments, blocks, aside: it["aside"] === true, at: it["at"],
    ...(slash === undefined ? {} : { command: slash }),
    ...(isString(it["applied"]) ? { applied: it["applied"] } : {}),
  }
}

/** 盘上那份**逐条核**：认不出的那一条丢掉，别的照留——一份坏草稿不该连累其余几十份。 */
export function parseDrafts(raw: unknown): Record<string, StoredDraft> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {}
  // 经 `fromEntries` 建，不逐个赋值：键是盘上读来的，一个 `__proto__` 会改掉原型
  const kept = Object.entries(raw as Record<string, unknown>).flatMap(([key, value]) => {
    const one = draft(value)
    return one === undefined || blankDraft(one) ? [] : [[key, one] as const]
  })
  return pruneDrafts(Object.fromEntries(kept))
}

/** 只留最近 `limit` 份。 */
export function pruneDrafts(drafts: Readonly<Record<string, StoredDraft>>, limit = MAX_DRAFTS): Record<string, StoredDraft> {
  const kept = Object.entries(drafts).sort(([, a], [, b]) => b.at - a.at).slice(0, limit)
  return Object.fromEntries(kept)
}
