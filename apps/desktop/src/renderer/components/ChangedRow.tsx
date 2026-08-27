import type { PatchSkip, ReviewPatch } from "../../shared/review.js"
import type { ChangedFile } from "../changes.js"
import { splitPath } from "../diff.js"
import { relPath } from "../tool.js"
import { requestFilePreview } from "../file-preview-request.js"
import { CopyIcon, RevealIcon } from "./icons.js"
import { FileIcon } from "./icons-activity.js"
import { outside } from "./file-row.js"

interface Props {
  file: ChangedFile
  cwd: string
  threadId: string
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  /** 点文件名去哪儿：**右侧审核面板里那份 diff**。 */
  onOpen: (path: string) => void
}

const SKIP_TEXT: Readonly<Record<PatchSkip, string>> = {
  binary: "（二进制文件不显示补丁）",
  large: "（补丁过大，请在审核面板或外部工具中查看）",
  gone: "（文件已不存在）",
  failed: "（读取这份净改动失败，请重试）",
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
 * 改动卡里的一行。**点文件名直接去右侧审核面板看 diff。**
 *
 * 上一版点了是就地展开一段补丁。两个毛病：一是展开之后这张卡把正文顶开，
 * 而你本来只是想看一眼那处改动；二是**它展开的是引擎当时报的那份**，
 * 而右侧面板给的是「现在相对开场」的那份，同一个文件两处两个答案。
 * 现在只留一条路：去面板。
 */
export function ChangedRow({
  file,
  cwd,
  threadId,
  onReveal,
  onCopy,
  onOpen,
}: Props): React.JSX.Element {
  const shown = splitPath(relPath(file.path, cwd))
  return (
    <div className="changed__file">
      <div className="changed__row">
        <button
          type="button"
          className="changed__name"
          title={`在右侧审核面板里看这份改动\n${file.path}`}
          onClick={() => {
            onOpen(file.path)
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
    </div>
  )
}
