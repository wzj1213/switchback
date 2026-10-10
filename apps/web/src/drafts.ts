/**
 * 手机上输入框里没发出去的话：每条会话一份，存在这台手机的浏览器里（localStorage）。
 *
 * - **只在本机。** 两端同时改同一条会话没法合并，查到的同类产品也都不跨设备同步草稿；
 *   两端之间要交接的（取回、接不回时退回）继续走宿主的 `Thread.draft`。
 * - 只存文字（这一端不贴图），留最近 20 条；解除配对时清掉。
 * - 「并过哪一版宿主草稿」和正文存在同一条里：分开存的话，重载后正文里已经有取回的那句，
 *   宿主那份还没被发送消费掉，就会再并一遍（桌面端同一个理由，见 desktop `shared/drafts.ts`）。
 */
export interface WebDraft {
  text: string
  applied?: string
  at: number
}

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

const KEY = "switchback:drafts"
export const MAX_WEB_DRAFTS = 20

function all(storage: DraftStorage): Map<string, WebDraft> {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? "{}") as unknown
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return new Map()
    return new Map(Object.entries(raw as Record<string, unknown>).flatMap(([threadId, value]) => {
      const it = value as Partial<WebDraft> | null
      if (typeof it?.text !== "string" || typeof it.at !== "number") return []
      const draft: WebDraft = { text: it.text, at: it.at, ...(typeof it.applied === "string" ? { applied: it.applied } : {}) }
      return [[threadId, draft] as const]
    }))
  } catch {
    return new Map()
  }
}

export function readDraft(storage: DraftStorage | undefined, threadId: string): WebDraft | undefined {
  return storage === undefined ? undefined : all(storage).get(threadId)
}

/** 存一份。没字、也没并过宿主草稿的就是删。 */
export function writeDraft(
  storage: DraftStorage | undefined,
  threadId: string,
  draft: { text: string; applied?: string | undefined },
  at: number,
): void {
  if (storage === undefined) return
  const drafts = all(storage)
  drafts.delete(threadId)
  if (draft.text !== "" || draft.applied !== undefined) {
    drafts.set(threadId, { text: draft.text, at, ...(draft.applied === undefined ? {} : { applied: draft.applied }) })
  }
  const kept = [...drafts].sort(([, a], [, b]) => b.at - a.at).slice(0, MAX_WEB_DRAFTS)
  try {
    storage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {
    // 存不下（隐私模式、满了）就存不下：这一次打的字还在输入框里
  }
}

export function clearDrafts(storage: DraftStorage | undefined): void {
  try {
    storage?.removeItem(KEY)
  } catch {
    // 忽略
  }
}

/** 这台手机的 localStorage。Safari 隐私模式下一碰就抛，那就当没有。 */
export function localDrafts(): DraftStorage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
