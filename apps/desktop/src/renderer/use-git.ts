import { useCallback, useEffect, useState } from "react"
import type { CommitResult, GitState } from "../shared/git.js"
import { bridge } from "./use-async.js"
import { announceWorksiteChanged } from "./useWorksite.js"

/**
 * 审查页「提交」那一条的数据：当前 Git 状态，以及提交 / 暂存两个动作。
 *
 * **跟着审核清单一起重读**（`revision`）：清单在跑完一轮、窗口回到前台时都会重问 git，
 * 这一条的计数必须和上面那张清单说的是同一个时刻，不然会出现「清单空了、这里还写着 3 个未暂存」。
 */
export function useGit(threadId: string, cwd: string, revision: string): {
  state: GitState | undefined
  reload: () => void
} {
  const switchback = bridge()
  const [state, setState] = useState<GitState | undefined>(undefined)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (switchback === undefined) return undefined
    const live = { on: true }
    void switchback.gitState({ threadId, cwd }).then(
      (next) => {
        if (live.on) setState(next)
      },
      () => undefined,
    )
    return () => {
      live.on = false
    }
  }, [switchback, threadId, cwd, revision, nonce])
  return { state, reload: useCallback(() => setNonce((n) => n + 1), []) }
}

/** 提交与暂存。做完一件就让调用方重读（清单与计数都变了）。 */
export function useGitActions(threadId: string, cwd: string, changed: () => void): {
  busy: boolean
  result: CommitResult | undefined
  commit: (message: string, all: boolean) => Promise<boolean>
  stage: (rel: string, stage: boolean) => void
  undo: (full: string) => void
} {
  const switchback = bridge()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CommitResult | undefined>(undefined)
  const run = async (job: Promise<CommitResult> | undefined): Promise<boolean> => {
    if (job === undefined) return false
    setBusy(true)
    const done = await job.catch((error: unknown): CommitResult => ({ ok: false, error: String(error) }))
    setBusy(false)
    setResult(done)
    changed()
    announceWorksiteChanged()
    return done.ok
  }
  return {
    busy,
    result,
    commit: (message, all) => run(switchback?.gitCommit({ threadId, cwd, message, all })),
    stage: (rel, stage) => {
      void run(switchback?.gitStage({ threadId, cwd, rel, stage }))
    },
    undo: (full) => {
      void run(switchback?.gitUndo({ threadId, cwd, full }))
    },
  }
}

/** 暂存只对「还没提交」的那几档有意义；已提交、分支两档看的是历史，不给按钮。 */
const STAGEABLE: ReadonlySet<string> = new Set(["last-turn", "uncommitted", "unstaged", "staged"])

/**
 * 审核面板要的那一整套：提交条的数据与动作、文件头上的暂存按钮。
 *
 * **跨几个仓库并起来的清单（`spread`）不给**：那时「提交」是几个仓库各提各的，
 * 一颗按钮说不清提交到了哪儿。
 */
export function useReviewGit(req: {
  threadId: string
  cwd: string
  scope: string
  review: { revision: string; noRepo: boolean; spread: boolean; reload: () => void }
}): {
  bar: {
    state: GitState | undefined
    busy: boolean
    result: CommitResult | undefined
    onCommit: (message: string, all: boolean) => Promise<boolean>
    onUndo: (full: string) => void
    onReload: () => void
  }
  onStage: ((rel: string, stage: boolean) => void) | undefined
} {
  const { threadId, cwd, scope, review } = req
  const git = useGit(threadId, cwd, review.revision)
  const actions = useGitActions(threadId, cwd, review.reload)
  const usable = !review.noRepo && !review.spread
  return {
    bar: {
      state: usable ? git.state : undefined,
      busy: actions.busy,
      result: actions.result,
      onCommit: actions.commit,
      onUndo: actions.undo,
      onReload: git.reload,
    },
    onStage: usable && STAGEABLE.has(scope) ? actions.stage : undefined,
  }
}
