import { codesOf } from "./worksite.js"

export interface TreeSnapshot {
  tree: string
  env: NodeJS.ProcessEnv
  /** 当前真实 index；拿不到时不猜“已暂存”。 */
  indexTree?: string
}

interface Request {
  current: TreeSnapshot
  status: () => Promise<string>
  treeDiff: (from: string, to: string) => Promise<string>
}

/** 当前 Git 状态，以及 index 与最终工作树仍不一致的路径。 */
export async function stageInfo(request: Request): Promise<{
  codes: ReadonlyMap<string, string>
  unstaged: ReadonlySet<string> | undefined
}> {
  const pending = request.current.indexTree === undefined
    ? Promise.resolve(undefined)
    : request.treeDiff(request.current.indexTree, request.current.tree)
  const [status, unstaged] = await Promise.all([request.status(), pending])
  return {
    codes: new Map(codesOf(status).map((entry) => [entry.rel, entry.code])),
    unstaged: unstaged === undefined
      ? undefined
      : new Set(unstaged.split("\0").filter((path) => path !== "")),
  }
}
