import { useEffect, useState } from "react"
import type { ReviewPatch } from "../shared/review.js"
import type { ReviewScope } from "../shared/review.js"
import { parseDiff } from "./diff.js"
import { numbered, trimMeta, type NumberedLine } from "./review-lines.js"
import type { Locale } from "@switchback/i18n"
import { REVIEW_PATCH } from "./review-patch.messages.js"

export interface PatchData extends ReviewPatch {
  lines: readonly NumberedLine[]
  loading: boolean
}

const EMPTY = { patch: "", added: 0, removed: 0, lines: [] } as const


/** 复制动作不能在没有正文时静默退化成一条路径。 */
export function reviewCopyText(rel: string, patch: ReviewPatch, locale: Locale): string {
  if (patch.patch !== "") return patch.patch
  const m = REVIEW_PATCH[locale]
  const note = patch.skip === undefined ? m.none : m.skip[patch.skip]
  return `${rel}\n\n${note}`
}

/** 一个文件的真实基线补丁；点开哪个取哪个，IPC 拒绝会落到明确失败态。 */
export function usePatch(
  cwd: string,
  rel: string | undefined,
  query: { context: number; stamp: string; threadId: string; revision?: string; scope?: ReviewScope },
): PatchData {
  const key = `${cwd}\u0000${rel ?? ""}\u0000${String(query.context)}\u0000${query.stamp}\u0000${query.threadId}\u0000${query.revision ?? ""}\u0000${query.scope ?? "conversation"}`
  const [out, setOut] = useState<(Omit<PatchData, "loading"> & { key: string }) | undefined>()
  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.switchback
    if (cwd === "" || rel === undefined || bridge === undefined) return undefined
    let live = true
    void bridge
      .workPatch(cwd, rel, { context: query.context, threadId: query.threadId, scope: query.scope })
      .then((got) => {
        if (live) setOut({ key, ...got, lines: trimMeta(numbered(parseDiff(got.patch, "update"))) })
      })
      .catch(() => {
        if (live) setOut({ key, patch: "", skip: "failed", added: 0, removed: 0, lines: [] })
      })
    return () => {
      live = false
    }
  }, [cwd, rel, key, query.context, query.scope, query.threadId])
  if (rel === undefined) return { ...EMPTY, loading: false }
  if (out?.key !== key) return { ...EMPTY, loading: true }
  return { ...out, loading: false }
}
