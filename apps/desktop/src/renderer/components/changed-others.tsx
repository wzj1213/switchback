import { useEffect, useRef, useState } from "react"
import { canonicalPath, type ChangedFile } from "../changes.js"
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
  const [result, setResult] = useState<{ key: string; paths: readonly string[] } | undefined>()
  const baseline = useRef<{ cwd: string; paths: ReadonlySet<string> } | undefined>(undefined)
  const normalizedCwd = canonicalPath(cwd, "")
  const mine = known.map((file) => canonicalPath(file.path, cwd)).join("\u0000")
  const key = `${normalizedCwd}\u0000${stamp}\u0000${mine}`
  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.omni
    if (cwd === "" || bridge === undefined) return undefined
    let live = true
    void bridge.workChanges(cwd).then((out) => {
      if (!live) return
      const all = out?.paths ?? []
      const normalized = all.map((path) => canonicalPath(path, cwd))
      if (baseline.current?.cwd !== normalizedCwd) {
        baseline.current = { cwd: normalizedCwd, paths: new Set(normalized) }
      }
      const before = baseline.current.paths
      const ours = new Set(mine === "" ? [] : mine.split("\u0000"))
      setResult({
        key,
        paths: all.filter(
          (_, index) => !before.has(normalized[index] ?? "") && !ours.has(normalized[index] ?? ""),
        ),
      })
    })
    return () => {
      live = false
    }
  }, [cwd, key, mine, normalizedCwd])
  return result?.key === key ? result.paths : []
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
