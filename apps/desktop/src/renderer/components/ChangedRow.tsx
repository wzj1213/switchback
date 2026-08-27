import { useState } from "react"
import type { FileChange, FileChangeKind } from "@omni/protocol"
import type { PatchSkip, ReviewKind, ReviewPatch } from "../../shared/review.js"
import type { ChangedFile } from "../changes.js"
import { splitPath } from "../diff.js"
import { usePatch, type PatchData } from "../review.js"
import { relPath } from "../tool.js"
import { requestFilePreview } from "../file-preview-request.js"
import { FileDiff } from "./Diff.js"
import { CopyIcon, RevealIcon } from "./icons.js"
import { FileIcon } from "./icons-activity.js"
import { outside } from "./file-row.js"

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
  const patch = await bridge.workPatch(cwd, file.review.rel, { context: 3, threadId }).catch(() => undefined)
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
      <RevealIcon size={14} />
    </button>
  )
}

function PreviewFile({ file, threadId, cwd }: {
  file: ChangedFile
  threadId: string
  cwd: string
}): React.JSX.Element | null {
  const deleted = file.review?.kind === "delete" || (file.review === undefined && file.last.kind === "delete")
  if (deleted) return null
  return (
    <button
      type="button"
      className="changed__act"
      aria-label="预览文件"
      title="在工作台预览"
      onClick={() => {
        requestFilePreview(threadId, cwd, file.path)
      }}
    >
      <FileIcon size={14} />
    </button>
  )
}

/**
 * 展开一行却什么都看不到，是这张清单上最常见的一次失望。
 *
 * 两种情形合起来就是它：**工作区不是 Git 仓库**（或者这个文件根本不在工作区里），
 * 于是补丁只能指望引擎自己带；而**有几家引擎报编辑时不带补丁**，只报路径和增删数。
 * 两条一撞，`FileDiff` 拿到一份空补丁，画出来是一个只有文件头的空盒子——
 * 和「这个文件没有改动」长得一模一样。
 *
 * 所以这里改成直说：没有补丁可看，以及还能往哪儿看（工作台里那份当前内容）。
 */
function bareOf(file: ChangedFile): boolean {
  return file.review === undefined && (file.last.diff ?? "") === ""
}

/** 展开之后这一行底下画什么。四种互斥的结局，抽出来是圈复杂度闸门逼的——这一刀也顺。 */
function ChangedBody({ file, patch }: { file: ChangedFile; patch: PatchData }): React.JSX.Element {
  if (patch.loading) return <p className="changed__note">正在读取当前净补丁…</p>
  if (patch.skip !== undefined) return <p className="changed__note">{SKIP_TEXT[patch.skip]}</p>
  if (bareOf(file)) {
    return (
      <p className="changed__note">
        这次编辑引擎没有带补丁，核不出改了什么；文件当前内容可以在工作台打开。
      </p>
    )
  }
  return (
    <FileDiff
      file={actualFile(file, patch.patch)}
      parseAs={file.review === undefined ? undefined : "update"}
    />
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
        {/* 「对话不在目标改动目录」时，这一行是唯一能看出来的地方——
            而那正是补丁看不看得到、文件点不点得开的分水岭 */}
        {outside(file.path, cwd) ? <span className="changed__tag">工作区外</span> : null}
        <span className="changed__stat">
          <Stat added={file.added} removed={file.removed} />
        </span>
        <PreviewFile file={file} threadId={threadId} cwd={cwd} />
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
          <CopyIcon size={14} />
        </button>
      </div>
      {open ? <ChangedBody file={file} patch={patch} /> : null}
    </div>
  )
}
