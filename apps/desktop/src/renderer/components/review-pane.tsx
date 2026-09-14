import type { ReviewFile } from "../../shared/review.js"
import { reviewCopyText, type PatchData } from "../review.js"
import { reveal } from "../reveal.js"
import { ReviewDiff } from "./ReviewDiff.js"
import { ReviewFileHead } from "./review-file-head.js"
import { requestFilePreview } from "../file-preview-request.js"

/** 审核编辑组的补丁区；空态与已选文件在这里切换。 */
export function ReviewPane({ file, patch, empty, split, box, onCopy, cwd, threadId, wrap }: {
  file: ReviewFile | undefined
  patch: PatchData
  empty: string
  split: boolean
  wrap?: boolean
  cwd: string
  threadId: string
  /**
   * 量宽用。**必须挂在这个盒子上，不能挂外面那扇面板**——面板里还并排站着
   * 260px 的文件清单，两者的宽度在常规窗口下差将近一倍（见 `review.css` 的
   * `.rv__pane`）。空态那一支也要挂：那时候人正在拉宽窗口等它变宽。
   */
  box: React.RefObject<HTMLElement | null>
  onCopy: (text: string) => unknown
}): React.JSX.Element {
  if (file === undefined) {
    return <section className="rv__pane" ref={box}><p className="rvd__note">{empty}</p></section>
  }
  return (
    <section className="rv__pane" ref={box}>
      <ReviewFileHead
        key={file.rel}
        file={file}
        copyDisabled={patch.loading || patch.skip === "failed"}
        onReveal={() => { reveal(file.path) }}
        onCopy={() => onCopy(reviewCopyText(file.rel, patch))}
        onPreview={file.kind === "delete" ? undefined : () => { requestFilePreview(threadId, cwd, file.path) }}
      />
      <ReviewDiff
        key={file.path}
        lines={patch.lines}
        path={file.rel}
        {...(patch.skip === undefined ? {} : { skip: patch.skip })}
        split={split}
        loading={patch.loading}
        wrap={wrap}
      />
    </section>
  )
}
