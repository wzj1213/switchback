import { useState } from "react"
import type { FileChange, FileChangeKind } from "@omni/protocol"
import type { PatchSkip, ReviewKind, ReviewPatch } from "../../shared/review.js"
import type { ChangedFile } from "../changes.js"
import { splitPath } from "../diff.js"
import { usePatch } from "../review.js"
import { relPath } from "../tool.js"
import { FileDiff } from "./Diff.js"
import { CopyIcon, RevealIcon } from "./icons.js"

interface Props {
  file: ChangedFile
  cwd: string
  stamp: string
  threadId: string
  onReveal: (path: string) => void
  onCopy: (text: string) => void
}

const SKIP_TEXT: Readonly<Record<PatchSkip, string>> = {
  binary: "（二进制文件不显示补丁）",
  large: "（补丁过大，请在审核面板或外部工具中查看）",
  gone: "（文件已不存在）",
  failed: "（读取这份净改动失败，请重试）",
}

function fileKind(kind: ReviewKind): FileChangeKind {
  if (kind === "delete") return "delete"
  if (kind === "add" || kind === "untracked") return "add"
  return "update"
}

function actualFile(file: ChangedFile, patch: string): FileChange {
  const review = file.review
  if (review === undefined) return file.last
  return {
    path: file.path,
    kind: fileKind(review.kind),
    diff: patch,
    added: file.added,
    removed: file.removed,
  }
}

function bodyOf(patch: ReviewPatch): string {
  if (patch.patch !== "") return patch.patch
  return patch.skip === undefined ? "（当前没有净改动）" : SKIP_TEXT[patch.skip]
}

async function copyFile(
  file: ChangedFile,
  cwd: string,
  onCopy: (text: string) => void,
  threadId: string,
): Promise<void> {
  const bridge = typeof window === "undefined" ? undefined : window.omni
  if (file.review === undefined || bridge === undefined) {
    onCopy(`${file.path}\n\n${file.last.diff ?? "（这次编辑没有带补丁）"}`)
    return
  }
  const patch = await bridge.workPatch(cwd, file.review.rel, 3, threadId).catch(() => undefined)
  onCopy(`${file.path}\n\n${patch === undefined ? "（读取当前净补丁失败）" : bodyOf(patch)}`)
}

function Stat({ added, removed }: { added: number; removed: number }): React.JSX.Element {
  return (
    <>
      {added > 0 ? <span className="diffstat__add">+{added}</span> : null}
      {removed > 0 ? <span className="diffstat__del">−{removed}</span> : null}
    </>
  )
}

function RevealFile({ file, onReveal }: { file: ChangedFile; onReveal: (path: string) => void }): React.JSX.Element | null {
  const review = file.review
  if (review?.kind === "delete" || (review === undefined && file.last.kind === "delete")) return null
  return (
    <button
      type="button"
      className="changed__act"
      aria-label="在访达中显示"
      title="在访达中显示"
      onClick={() => {
        onReveal(file.path)
      }}
    >
      <RevealIcon size={12} />
    </button>
  )
}

export function ChangedRow({
  file,
  cwd,
  stamp,
  threadId,
  onReveal,
  onCopy,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const review = file.review
  const patch = usePatch(cwd, open ? review?.rel : undefined, {
    context: 3,
    stamp,
    threadId,
  })
  const shown = splitPath(relPath(file.path, cwd))
  return (
    <div className="changed__file">
      <div className="changed__row">
        <button
          type="button"
          className="changed__name"
          title={file.path}
          aria-expanded={open}
          onClick={() => {
            setOpen((was) => !was)
          }}
        >
          <span className="changed__dir">{shown.dir}</span>
          <span className="changed__base">{shown.name}</span>
        </button>
        <span className="changed__stat">
          <Stat added={file.added} removed={file.removed} />
        </span>
        <RevealFile file={file} onReveal={onReveal} />
        <button
          type="button"
          className="changed__act"
          aria-label="复制这份当前净改动"
          title="复制这份当前净改动"
          onClick={() => {
            void copyFile(file, cwd, onCopy, threadId)
          }}
        >
          <CopyIcon size={12} />
        </button>
      </div>
      {open && patch.loading ? <p className="changed__note">正在读取当前净补丁…</p> : null}
      {open && !patch.loading && patch.skip !== undefined ? (
        <p className="changed__note">{SKIP_TEXT[patch.skip]}</p>
      ) : null}
      {open && !patch.loading && patch.skip === undefined ? (
        <FileDiff
          file={actualFile(file, patch.patch)}
          parseAs={review === undefined ? undefined : "update"}
        />
      ) : null}
    </div>
  )
}
