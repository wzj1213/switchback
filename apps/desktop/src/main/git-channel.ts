import type { CommitResult, GitState } from "../shared/git.js"
import { gitCommit, gitStage, gitState, gitUndo, runGit, type GitRun } from "./git-commit.js"
import { ownedWorksite, type WorksiteSearch } from "./worksite-search.js"
import type { Channels } from "./channels.js"

/**
 * 审查页「提交」那一条的通道。守卫同审核面板（`work-review-channel.ts`）：
 * **只认这台机器上确实有会话在用的工作区**，渲染层递来的别的路径一概不理。
 *
 * 同一个工作区的 git 写操作排成一队：连点几个文件的「暂存」会并发跑 `git add`，
 * 撞上 `index.lock` 就是一串莫名其妙的失败。
 */
const MESSAGE_CHARS = 20_000
const PATH_CHARS = 4096
const NOT_OURS: CommitResult = { ok: false, error: "not-ours" }
const NO_REPO: GitState = { repo: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }

export function createGitChannels(worksites: WorksiteSearch, run: GitRun = runGit): {
  state: (value: unknown) => Promise<GitState>
  commit: (value: unknown) => Promise<CommitResult>
  stage: (value: unknown) => Promise<CommitResult>
  undo: (value: unknown) => Promise<CommitResult>
} {
  const queues = new Map<string, Promise<unknown>>()
  const queued = <T>(cwd: string, job: () => Promise<T>): Promise<T> => {
    const next = (queues.get(cwd) ?? Promise.resolve()).then(job, job)
    queues.set(cwd, next.catch(() => undefined))
    return next
  }
  return {
    state: async (value) => {
      const owned = ownedWorksite(value, worksites.owns)
      return owned === undefined ? NO_REPO : queued(owned.cwd, () => gitState(owned.cwd, run))
    },
    commit: async (value) => {
      const owned = ownedWorksite(value, worksites.owns)
      if (owned === undefined) return NOT_OURS
      const { message, all } = value as { message?: unknown; all?: unknown }
      if (typeof message !== "string" || message.length > MESSAGE_CHARS) return { ok: false, error: "bad-message" }
      return queued(owned.cwd, () => gitCommit(owned.cwd, { message, all: all === true }, run))
    },
    stage: async (value) => {
      const owned = ownedWorksite(value, worksites.owns)
      if (owned === undefined) return NOT_OURS
      const { rel, stage } = value as { rel?: unknown; stage?: unknown }
      if (typeof rel !== "string" || rel === "" || rel.length > PATH_CHARS) return { ok: false, error: "bad-path" }
      return queued(owned.cwd, () => gitStage(owned.cwd, { rel, stage: stage === true }, run))
    },
    undo: async (value) => {
      const owned = ownedWorksite(value, worksites.owns)
      if (owned === undefined) return NOT_OURS
      const { full } = value as { full?: unknown }
      if (typeof full !== "string" || !/^[0-9a-f]{40}([0-9a-f]{24})?$/u.test(full)) return { ok: false, error: "bad-commit" }
      return queued(owned.cwd, () => gitUndo(owned.cwd, { full }, run))
    },
  }
}

export function installGitChannel(worksites: WorksiteSearch, channels: Channels): void {
  const git = createGitChannels(worksites)
  channels.handle("switchback:gitState", (req: unknown) => git.state(req))
  channels.handle("switchback:gitCommit", (req: unknown) => git.commit(req))
  channels.handle("switchback:gitStage", (req: unknown) => git.stage(req))
  channels.handle("switchback:gitUndo", (req: unknown) => git.undo(req))
}
