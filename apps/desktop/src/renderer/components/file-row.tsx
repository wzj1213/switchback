import type { PreviewTarget } from "../workbench.js"
import { relPath } from "../tool.js"
import { FileIcon } from "./icons-activity.js"

/**
 * 侧栏文件清单的一行。
 *
 * **名字排第一。** 原来整行只画一条相对路径，靠 CSS 从右边截断——
 * 而 Java 那种深目录（`order-service/order-service-core/src/main/java/…`）
 * 被截掉的正好是文件名，一列看下来全是同样的前缀。现在名字单独一行，
 * 目录收成末两级挂在下面，完整路径留在 `title` 里。
 */

export function baseName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? path
}

/** 目录只留末两级：越靠近文件的那几级越能说明它是谁。 */
export function dirHint(path: string, cwd: string): string {
  const rel = relPath(path.replace(/\\/g, "/"), cwd.replace(/\\/g, "/"))
  const cut = rel.lastIndexOf("/")
  if (cut <= 0) return ""
  const dir = rel.slice(0, cut)
  const parts = dir.split("/").filter((part) => part !== "")
  return parts.length <= 2 ? dir : `…/${parts.slice(-2).join("/")}`
}

export function outside(path: string, cwd: string): boolean {
  const normalized = path.replace(/\\/g, "/")
  // 工作区搜索返回相对路径；它的根就是当前 cwd，不能贴成「工作区外」。
  if (!normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized)) return false
  const root = cwd.replace(/\\/g, "/")
  const base = root.endsWith("/") ? root : `${root}/`
  return !normalized.startsWith(base)
}

export function PathRow({ path, cwd, threadId, meta, disabled, onPick }: {
  path: string
  cwd: string
  threadId: string
  meta?: string
  disabled?: boolean
  onPick: (target: PreviewTarget) => void
}): React.JSX.Element {
  const hint = dirHint(path, cwd)
  const tag = disabled === true ? "已删除" : (outside(path, cwd) ? "工作区外" : meta)
  return (
    <button type="button" className="file-row" disabled={disabled}
      title={disabled === true ? `${path}\n文件已删除` : path}
      onClick={() => { onPick({ threadId, cwd, path }) }}>
      <span className="file-row__icon"><FileIcon size={13} /></span>
      <span className="file-row__body">
        <span className="file-row__name">{baseName(path)}</span>
        {hint === "" ? null : <span className="file-row__dir">{hint}</span>}
      </span>
      {tag === undefined ? null : <span className="file-row__meta">{tag}</span>}
    </button>
  )
}
