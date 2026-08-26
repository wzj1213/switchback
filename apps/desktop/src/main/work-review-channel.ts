import { ipcMain } from "electron"
import type { ReviewPatch, ReviewScope } from "../shared/review.js"
import { ownedWorksite, type WorksiteSearch } from "./worksite-search.js"
import { workPatch, workReview, type Review, type ReviewSource } from "./workdiff.js"
import type { WorktreeBaselines } from "./worktree-baseline.js"

const GONE: ReviewPatch = { patch: "", skip: "gone", added: 0, removed: 0 }
const WANTED = 1000
const PATH_CHARS = 4096

interface ReviewRequest {
  threadId: string
  cwd: string
  wanted?: readonly string[]
  scope?: ReviewScope
}

interface PatchRequest extends ReviewRequest {
  rel: string
  context?: number
}

export interface WorkReviewOps {
  review: (cwd: string, source?: ReviewSource) => Promise<Review | undefined>
  patch: (cwd: string, rel: string, context?: number, source?: ReviewSource) => Promise<ReviewPatch>
}

function reviewRequest(value: unknown, worksites: WorksiteSearch): ReviewRequest | undefined {
  const owned = ownedWorksite(value, worksites.owns)
  if (owned === undefined) return undefined
  const wanted = (value as { wanted?: unknown }).wanted
  const scope = (value as { scope?: unknown }).scope
  if (wanted !== undefined && (!Array.isArray(wanted) || !wanted.every((path) => typeof path === "string"))) {
    return undefined
  }
  const scopes: readonly ReviewScope[] = ["last-turn", "uncommitted", "unstaged", "staged", "last-commit", "branch"]
  if (scope !== undefined && !scopes.includes(scope as ReviewScope)) return undefined
  return {
    ...owned,
    ...(scope === undefined ? {} : { scope: scope as ReviewScope }),
    ...(wanted === undefined
      ? {}
      : { wanted: (wanted as string[]).slice(0, WANTED).map((path) => path.slice(0, PATH_CHARS)) }),
  }
}

function patchRequest(value: unknown, worksites: WorksiteSearch): PatchRequest | undefined {
  const common = reviewRequest(value, worksites)
  if (common === undefined) return undefined
  const { rel, context } = value as { rel?: unknown; context?: unknown }
  if (typeof rel !== "string" || rel === "") return undefined
  return {
    ...common,
    rel: rel.slice(0, PATH_CHARS),
    ...(typeof context === "number" && Number.isFinite(context) ? { context } : {}),
  }
}

export function createWorkReviewChannels(
  worksites: WorksiteSearch,
  baselines?: WorktreeBaselines,
  ops: WorkReviewOps = { review: workReview, patch: workPatch },
): {
  review: (value: unknown) => Promise<Review | undefined>
  patch: (value: unknown) => Promise<ReviewPatch>
} {
  return {
    review: async (value) => {
      const req = reviewRequest(value, worksites)
      return req === undefined
        ? undefined
        : ops.review(req.cwd, { baselines, threadId: req.threadId, wanted: req.wanted, scope: req.scope })
    },
    patch: async (value) => {
      const req = patchRequest(value, worksites)
      return req === undefined
        ? GONE
        : ops.patch(req.cwd, req.rel, req.context ?? 3, { baselines, threadId: req.threadId, scope: req.scope })
    },
  }
}

export function installReviewChannel(baselines: WorktreeBaselines, worksites: WorksiteSearch): void {
  const channels = createWorkReviewChannels(worksites, baselines)
  ipcMain.handle("omni:workReview", (_e, req: unknown) => channels.review(req))
  ipcMain.handle("omni:workPatch", (_e, req: unknown) => channels.patch(req))
}
