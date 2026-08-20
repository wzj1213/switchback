import type { Item } from "@omni/protocol"
import { sessionPath, type KimiApi } from "./http.js"
import { toTranscript, TRANSCRIPT_ITEM_MAX } from "./transcript.js"
import type { KimiTranscriptPage } from "./wire.js"

const PAGE_SIZE = 100

function oldestTurn(page: KimiTranscriptPage): string | undefined {
  for (const entry of page.items) {
    if (entry.kind === "turn" && typeof entry.turnId === "string" && entry.turnId !== "") return entry.turnId
  }
  return undefined
}

function pagePath(sessionId: string, before: string | undefined): string {
  const query = `agent_id=main&page_size=${String(PAGE_SIZE)}`
  const cursor = before === undefined ? "" : `&before_turn=${encodeURIComponent(before)}`
  return sessionPath(sessionId, `/transcript?${query}${cursor}`)
}

/** 逐页数清总条数，但内存里只保留最近 1500 条，保证截断提示里的数字是真的。 */
export async function readKimiTranscript(api: KimiApi, sessionId: string): Promise<{ items: readonly Item[]; total: number }> {
  const seen = new Set<string>()
  let before: string | undefined
  let items: readonly Item[] = []
  let total = 0
  while (true) {
    const page = await api.get<KimiTranscriptPage>(pagePath(sessionId, before))
    const translated = toTranscript({ ...page, has_more: false })
    total += translated.total
    items = [...translated.items, ...items].slice(-TRANSCRIPT_ITEM_MAX)
    if (!page.has_more) return { items, total }
    const next = oldestTurn(page)
    if (next === undefined || seen.has(next)) throw new Error("Kimi transcript 分页游标没有前进")
    seen.add(next)
    before = next
  }
}
