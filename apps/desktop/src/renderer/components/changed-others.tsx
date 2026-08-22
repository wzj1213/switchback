import { useEffect, useRef, useState } from "react"
import type { ChangedFile } from "../changes.js"
import { relPath } from "../tool.js"
import { splitPath } from "../diff.js"
import { RevealIcon } from "./icons.js"

export const CHANGED_PREVIEW = 3

/** 比会话刚打开时多出来、但引擎没有通过编辑工具报告的 git 路径。 */
export function useOtherChanges(
  cwd: string,
  stamp: string,
  known: readonly ChangedFile[],
): readonly string[] {
  const [paths, setPaths] = useState<readonly string[]>([])
  const baseline = useRef<ReadonlySet<string> | undefined>(undefined)
  const mine = known.map((file) => file.path).join("\n")
  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.omni
    if (cwd === "" || bridge === undefined) {
      setPaths([])
      return undefined
    }
    let live = true
    void bridge.workChanges(cwd).then((out) => {
      if (!live) return
      const all = out?.paths ?? []
      baseline.current ??= new Set(all)
      const before = baseline.current
      const same = (a: string, b: string): boolean => a === b || a.endsWith(b) || b.endsWith(a)
      const ours = mine === "" ? [] : mine.split("\n")
      setPaths(all.filter((path) => !before.has(path) && !ours.some((our) => same(our, path))))
    })
    return () => {
      live = false
    }
  }, [cwd, stamp, mine])
  return paths
}

/** 置信度较低的 git 盲区单独成节，不混进“已编辑”的主数字。 */
export function ChangedOthers({
  paths,
  cwd,
  onReveal,
}: {
  paths: readonly string[]
  cwd: string
  onReveal: (path: string) => void
}): React.JSX.Element {
  return (
    <div className="changed__others">
      <p className="changed__note">
        另有 {paths.length} 个文件与 git 不同，<strong>不是</strong>通过编辑工具改的——
        可能是引擎跑的命令，也可能是你自己改的
      </p>
      {paths.slice(0, CHANGED_PREVIEW).map((path) => {
        const shown = splitPath(relPath(path, cwd))
        return (
          <div className="changed__row" key={path}>
            <span className="changed__name changed__name--flat" title={path}>
              <span className="changed__dir">{shown.dir}</span>
              <span className="changed__base">{shown.name}</span>
            </span>
            <button
              type="button"
              className="changed__act"
              aria-label="在访达中显示"
              title="在访达中显示"
              onClick={() => {
                onReveal(path)
              }}
            >
              <RevealIcon size={12} />
            </button>
          </div>
        )
      })}
      {paths.length <= CHANGED_PREVIEW ? null : (
        <p className="changed__note">…还有 {paths.length - CHANGED_PREVIEW} 个</p>
      )}
    </div>
  )
}
