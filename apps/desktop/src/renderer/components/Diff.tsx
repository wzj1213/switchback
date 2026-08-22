import { useState } from "react"
import type { FileChange, FileChangeKind } from "@omni/protocol"
import { kindLabel, parseDiff, splitPath, type DiffLine } from "../diff.js"
import { reveal, revealable } from "../reveal.js"

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
export function FileDiff({
  file,
  parseAs = file.kind,
}: {
  file: FileChange
  /** git 补丁无论新建/删除都是真 unified diff，展示类型与解析格式不能混为一谈。 */
  parseAs?: FileChangeKind
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const lines = parseDiff(file.diff ?? "", parseAs)
  const folded = !open && lines.length > FOLD_AT
  const shown = folded ? lines.slice(0, FOLD_AT) : lines
  const { dir, name } = splitPath(file.path)
  return (
    <div className="dfile">
      <div className="dfile__head">
        <span className={`dfile__kind dfile__kind--${file.kind}`}>{kindLabel(file.kind)}</span>
        {/* 路径点一下在访达里定位。**删掉的那种不做成链接**：文件已经不在了，
            点了什么都不会发生——那正是这个仓库一直在避免的那种元素 */}
        {file.kind === "delete" || !revealable(file.path) ? (
          <span className="dfile__path" title={file.path}>
            <span className="dfile__dir">{dir}</span>
            <span className="dfile__name">{name}</span>
          </span>
        ) : (
          <button
            type="button"
            className="dfile__path dfile__path--go"
            title={`在访达中显示\n${file.path}`}
            onClick={() => {
              reveal(file.path)
            }}
          >
            <span className="dfile__dir">{dir}</span>
            <span className="dfile__name">{name}</span>
          </button>
        )}
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
