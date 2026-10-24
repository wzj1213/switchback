import type { Item } from "@switchback/protocol"
import { sessionPath, type KimiApi } from "./http.js"
import { toTranscript, TRANSCRIPT_ITEM_MAX } from "./transcript.js"
import type { KimiTranscriptPage, KimiTranscriptTurn } from "./wire.js"

const PAGE_SIZE = 100
const RECOVERY_PAGE_SIZE = 10

function oldestTurn(page: KimiTranscriptPage): KimiTranscriptTurn | undefined {
  for (const entry of page.items) {
    const candidate = entry as Partial<KimiTranscriptTurn>
    if (
      entry.kind === "turn" &&
      typeof candidate.turnId === "string" &&
      candidate.turnId !== "" &&
      Array.isArray(candidate.steps)
    ) {
      return entry as KimiTranscriptTurn
    }
  }
  return undefined
}

function pagePath(sessionId: string, before: string | undefined): string {
  const query = `agent_id=main&page_size=${String(PAGE_SIZE)}`
  const cursor = before === undefined ? "" : `&before_turn=${encodeURIComponent(before)}`
  return sessionPath(sessionId, `/transcript?${query}${cursor}`)
}

/** 最近一页同时覆盖刚结束后紧接着启动原生任务的窄竞态。 */
export async function readKimiRecentTurns(
  api: KimiApi,
  sessionId: string,
): Promise<readonly KimiTranscriptTurn[]> {
  const path = sessionPath(
    sessionId,
    `/transcript?agent_id=main&page_size=${String(RECOVERY_PAGE_SIZE)}`,
  )
  const page = await api.get<KimiTranscriptPage>(path)
  return page.items.filter((entry): entry is KimiTranscriptTurn => entry.kind === "turn")
}

export async function readKimiCurrentTurn(
  api: KimiApi,
  sessionId: string,
  native: number,
): Promise<KimiTranscriptTurn | undefined> {
  return (await readKimiRecentTurns(api, sessionId)).find(
    (turn) => turn.turnId === `t${String(native)}`,
  )
}

/** 逐页数清总条数，但内存里只保留最近 1500 条，保证截断提示里的数字是真的。 */
export async function readKimiTranscript(
  api: KimiApi,
  sessionId: string,
): Promise<{ items: readonly Item[]; total: number }> {
  const seen = new Set<string>()
  let before: string | undefined
  let boundary: KimiTranscriptTurn | undefined
  let items: readonly Item[] = []
  let total = 0
  while (true) {
    const page = await api.get<KimiTranscriptPage>(pagePath(sessionId, before))
    const translated = toTranscript({ ...page, has_more: false }, boundary)
    total += translated.total
    items = [...translated.items, ...items].slice(-TRANSCRIPT_ITEM_MAX)
    if (!page.has_more) return { items, total }
    const next = oldestTurn(page)
    // 读转写的那头吞掉这个错（host 的 adoption 只是不搬），它只写给排查的人看
    if (next === undefined || seen.has(next.turnId)) throw new Error("Kimi transcript page cursor did not advance")
    seen.add(next.turnId)
    before = next.turnId
    boundary = next
  }
}
