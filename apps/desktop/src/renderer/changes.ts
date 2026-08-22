import type { FileChange, Item } from "@omni/protocol"
import type { ReviewFile } from "../shared/review.js"

export interface Changes {
  files: number
  added: number
  removed: number
  list: readonly ChangedFile[]
}

/** 会话里触达过的文件。`review` 有值时，数字与补丁都以 git 当前状态为准。 */
export interface ChangedFile {
  path: string
  added: number
  removed: number
  /** 非 git 工作区的诚实降级：只保留最后一次上报，不把多轮数字相加。 */
  last: FileChange
  review?: ReviewFile
}

function tally(list: readonly ChangedFile[]): Changes {
  return {
    files: list.length,
    added: list.reduce((sum, file) => sum + file.added, 0),
    removed: list.reduce((sum, file) => sum + file.removed, 0),
    list,
  }
}

/**
 * 引擎明确报告成功的编辑。
 *
 * 同一路径仍只占一行、仍按首次出现排序；但数字只留最后一次，绝不相加。
 * 这里回答的是「会话触达过谁」，真实净变更随后由 `reconcileChanges` 向 git 核实。
 */
export function reportedChangesOf(items: readonly Item[]): Changes {
  const files = new Map<string, ChangedFile>()
  for (const item of items) {
    if (item.kind !== "tool_call" || item.detail.kind !== "file_edit" || item.status !== "ok")
      continue
    for (const file of item.detail.files) {
      files.set(file.path, {
        path: file.path,
        added: file.added,
        removed: file.removed,
        last: file,
      })
    }
  }
  return tally([...files.values()])
}

/** `/tmp` 与 macOS 真实路径 `/private/tmp` 也要认成同一个文件。 */
function samePath(left: string, right: string): boolean {
  return left === right || left.endsWith(right) || right.endsWith(left)
}

/**
 * 用当前 git 清单校正会话变更。
 *
 * - 数字来自 `git diff HEAD --numstat`，不是多轮工具统计相加；
 * - git 清单里已经没有的会话文件说明净改动为零，整行消失；
 * - 工作区里其他脏文件不混进来，它们仍走置信度较低的「额外变动」区。
 */
export function reconcileChanges(reported: Changes, current: readonly ReviewFile[]): Changes {
  const list = reported.list.flatMap((file) => {
    const review = current.find((candidate) => samePath(file.path, candidate.path))
    if (review === undefined) return []
    return [{ ...file, path: review.path, added: review.added, removed: review.removed, review }]
  })
  return tally(list)
}
