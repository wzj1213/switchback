import type { ReviewFile } from "../../shared/review.js"
import type { reportedChangesOf } from "../changes.js"
import { ChangedOthers, CHANGED_PREVIEW } from "./changed-others.js"
import { ChangedRow } from "./ChangedRow.js"

/**
 * 展开之后那张清单。**它浮在正文上面，不在版面里占地方**（见 `Changed.tsx`）。
 *
 * 从 `Changed.tsx` 拆出来是行数闸门逼的，这一刀也顺：那边是「这张卡这一帧
 * 该不该出现、数字信谁的」，这边只是「一份清单怎么排」。
 */
export function ChangedList({
  files,
  others,
  othersTotal,
  all,
  cwd,
  stamp,
  threadId,
  note,
  onReveal,
  onCopy,
  onAll,
}: {
  files: ReturnType<typeof reportedChangesOf>["list"]
  others: readonly ReviewFile[]
  othersTotal: number
  all: boolean
  cwd: string
  stamp: string
  threadId: string
  note: string | undefined
  onReveal: (path: string) => void
  onCopy: (text: string) => void
  onAll: () => void
}): React.JSX.Element {
  const shown = all ? files : files.slice(0, CHANGED_PREVIEW)
  return (
    /*
     * **焦点落在清单本身，不落在第一个文件上。**
     *
     * `Popover` 打开时会把焦点送进面板（键盘用户要的），默认落点是它找到的
     * 第一颗可聚焦按钮——在这儿就是第一份文件，于是鼠标点开清单的人会看到
     * 第一行被一个焦点框套住，像是「已经选中了它」。给个 `-1` 的落点，
     * Esc 仍然还焦点给摘要，Tab 仍然从第一份文件开始走。
     */
    <div className="changed__list" tabIndex={-1} data-popover-autofocus>
      {note === undefined ? null : <p className="changed__note">{note}</p>}
      {shown.map((file) => (
        <ChangedRow
          key={file.path}
          file={file}
          cwd={cwd}
          stamp={stamp}
          threadId={threadId}
          onReveal={onReveal}
          onCopy={onCopy}
        />
      ))}
      {othersTotal === 0 ? null : (
        <ChangedOthers files={others} total={othersTotal} threadId={threadId}
          cwd={cwd} onReveal={onReveal} />
      )}
      {files.length <= CHANGED_PREVIEW ? null : (
        <button type="button" className="changed__more" onClick={onAll}>
          {all
            ? `只显示前 ${String(CHANGED_PREVIEW)} 个文件`
            : `再显示 ${String(files.length - CHANGED_PREVIEW)} 个文件`}
        </button>
      )}
    </div>
  )
}
