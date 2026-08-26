import type { ReviewFile } from "../../shared/review.js"
import { reviewCopyText, type PatchData } from "../review.js"
import { reveal } from "../reveal.js"
import { ReviewDiff } from "./ReviewDiff.js"
import { ReviewFileHead } from "./review-file-head.js"

/** 审核编辑组的补丁区；空态与已选文件在这里切换。 */
export function ReviewPane({ file, patch, empty, split, onCopy }: {
  file: ReviewFile | undefined
  patch: PatchData
  empty: string
  split: boolean
  onCopy: (text: string) => void
}): React.JSX.Element {
  if (file === undefined) {
    return <section className="rv__pane"><p className="rvd__note">{empty}</p></section>
  }
  return (
    <section className="rv__pane">
      <ReviewFileHead
        file={file}
        copyDisabled={patch.loading || patch.skip === "failed"}
        onReveal={() => { reveal(file.path) }}
        onCopy={() => { onCopy(reviewCopyText(file.rel, patch)) }}
      />
      <ReviewDiff
        lines={patch.lines}
        {...(patch.skip === undefined ? {} : { skip: patch.skip })}
        split={split}
        loading={patch.loading}
      />
    </section>
  )
}
