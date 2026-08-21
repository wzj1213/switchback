import type { ReactNode } from "react"
import { isGitHubLink } from "../links.js"
import { GitHubIcon, GlobeIcon } from "./icons-activity.js"

/** 对话中的外链。站点标记是识别线索，不另起预览卡抢正文空间。 */
export function ExternalLink({
  href,
  children,
}: {
  href?: string
  children?: ReactNode
}): React.JSX.Element {
  const target = href ?? ""
  return (
    <a className="outlink" href={href} target="_blank" rel="noreferrer noopener">
      <span className="outlink__icon">
        {isGitHubLink(target) ? <GitHubIcon size={12} /> : <GlobeIcon size={12} />}
      </span>
      {children}
    </a>
  )
}
