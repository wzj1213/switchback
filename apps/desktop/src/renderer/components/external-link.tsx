import type { ReactNode } from "react"
import { isGitHubLink } from "../links.js"
import { GitHubIcon, GlobeIcon } from "./icons-activity.js"
import { useMessages } from "../i18n.js"
import { EXTERNAL_LINK } from "./external-link.messages.js"

/** 对话中的外链。站点标记是识别线索，不另起预览卡抢正文空间。 */
export function ExternalLink({
  href,
  children,
}: {
  href?: string
  children?: ReactNode
}): React.JSX.Element {
  const m = useMessages(EXTERNAL_LINK)
  const target = href ?? ""
  return (
    <a className="outlink" href={href} target="_blank" rel="noreferrer noopener" title={m.open(target)}>
      <span className="outlink__icon">
        {isGitHubLink(target) ? <GitHubIcon size={14} /> : <GlobeIcon size={14} />}
      </span>
      {children}
    </a>
  )
}
