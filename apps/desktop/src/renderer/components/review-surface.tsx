import type { ComponentProps } from "react"
import type { TurnReviewTarget } from "../turn-review.js"
import { Review } from "./Review.js"
import { ReportedReview } from "./reported-review.js"

export function ReviewSurface({ reported, onGit, ...props }: ComponentProps<typeof Review> & {
  reported: TurnReviewTarget | undefined
  onGit: () => void
}): React.JSX.Element {
  if (reported?.threadId === props.threadId && reported.cwd === props.cwd) {
    return <ReportedReview target={reported} panel={props.panel} panelActive={props.panelActive}
      onCopy={props.onCopy} onClose={props.onClose} onGit={onGit} />
  }
  return <Review {...props} />
}
