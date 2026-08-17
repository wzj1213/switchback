import { useState } from "react"
import type { FileChange } from "@omni/protocol"
import { kindLabel, parseDiff, splitPath, type DiffLine } from "../diff.js"

/** 默认展示的行数。超过就折叠——一个 800 行的补丁摊在 transcript 里没人会读。 */
const FOLD_AT = 40

const SIGN: Readonly<Record<DiffLine["kind"], string>> = {
  add: "+",
  del: "−",
  ctx: " ",
  hunk: " ",
  meta: " ",
}

function Line({ line }: { line: DiffLine }): React.JSX.Element {
  return (
    <div className={`dl dl--${line.kind}`}>
      <span className="dl__sign" aria-hidden="true">
        {SIGN[line.kind]}
      </span>
      <span className="dl__text">{line.text === "" ? " " : line.text}</span>
    </div>
  )
}

function Stat({ added, removed }: { added: number; removed: number }): React.JSX.Element {
  return (
    <span className="dfile__stat">
      {added > 0 ? <span className="diffstat__add">+{added}</span> : null}
      {removed > 0 ? <span className="diffstat__del">−{removed}</span> : null}
    </span>
  )
}

/**
 * 一个文件的改动。
 *
 * 文件头（类型 + 路径 + 增删）永远可见，正文超过阈值折叠——**折叠的是正文不是文件头**，
 * 因为「改了哪些文件」是一眼要看到的，「具体改了什么」才是按需展开的。
 */
/** 一个文件的改动。变更汇总卡也用它——同一份补丁不该有两种画法。 */
export function FileDiff({ file }: { file: FileChange }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const lines = parseDiff(file.diff ?? "", file.kind)
  const folded = !open && lines.length > FOLD_AT
  const shown = folded ? lines.slice(0, FOLD_AT) : lines
  const { dir, name } = splitPath(file.path)
  return (
    <div className="dfile">
      <div className="dfile__head">
        <span className={`dfile__kind dfile__kind--${file.kind}`}>{kindLabel(file.kind)}</span>
        <span className="dfile__path" title={file.path}>
          <span className="dfile__dir">{dir}</span>
          <span className="dfile__name">{name}</span>
        </span>
        <Stat added={file.added} removed={file.removed} />
      </div>
      {lines.length === 0 ? null : (
        <div className="dfile__body">
          {shown.map((line, i) => (
            // 行没有天然 id，且这份数组在一次渲染里是不变的——用下标是正确的
            <Line key={`${String(i)}-${line.kind}`} line={line} />
          ))}
        </div>
      )}
      {folded ? (
        <button
          className="dfile__more"
          type="button"
          onClick={() => {
            setOpen(true)
          }}
        >
          还有 {lines.length - FOLD_AT} 行
        </button>
      ) : null}
    </div>
  )
}

/**
 * 文件改动的呈现。逐文件分组，不是一坨拼起来的文本——
 * 编程 agent 最重要的产出就是这个，值得按文件读。
 */
export function Diff({ files }: { files: readonly FileChange[] }): React.JSX.Element | null {
  if (files.length === 0) return null
  return (
    <div className="diff">
      {files.map((file) => (
        <FileDiff key={file.path} file={file} />
      ))}
    </div>
  )
}
