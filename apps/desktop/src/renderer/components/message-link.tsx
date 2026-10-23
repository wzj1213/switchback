import { createContext, useContext, useMemo, type ReactNode } from "react"
import { headingSlug, inlineTarget, messageTarget, resolveMessagePath } from "../message-links.js"
import { requestFilePreview } from "../file-preview-request.js"
import { ExternalLink } from "./external-link.js"
import { FileIcon } from "./icons-activity.js"
import { useMessages } from "../i18n.js"
import { MESSAGE_LINK } from "./message-link.messages.js"

interface LinkScope { threadId: string; cwd: string; documentPath?: string | undefined }
const Context = createContext<LinkScope | undefined>(undefined)
const InsideLink = createContext(false)

export function FileLinkScope({ threadId, cwd, documentPath, children }: LinkScope & { children: ReactNode }): React.JSX.Element {
  const value = useMemo(() => ({ threadId, cwd, documentPath }), [threadId, cwd, documentPath])
  return <Context value={value}>{children}</Context>
}

function jumpHeading(link: HTMLAnchorElement, fragment: string): void {
  const headings = link.closest(".md")?.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")
  const target = [...(headings ?? [])].find((heading) => headingSlug(heading.textContent) === fragment)
  if (target === undefined) return
  target.tabIndex = -1
  target.focus({ preventScroll: true })
  target.scrollIntoView({ block: "start", behavior: "instant" })
}

export function MessageLink({ href, children: content }: { href?: string; children?: ReactNode }): React.JSX.Element {
  const scope = useContext(Context)
  const m = useMessages(MESSAGE_LINK)
  const children = <InsideLink value={true}>{content}</InsideLink>
  const target = messageTarget(href ?? "")
  if (target.kind === "external") return <ExternalLink href={target.href}>{children}</ExternalLink>
  if (target.kind === "fragment") return (
    <a className="outlink" href={href} onClick={(event) => {
      event.preventDefault()
      jumpHeading(event.currentTarget, target.fragment)
    }}>{children}</a>
  )
  if (target.kind === "unsupported" || scope === undefined) {
    return <span title={m.unsupported}>{children}</span>
  }
  const path = resolveMessagePath(target.path, scope.cwd, scope.documentPath)
  const location = target.line === undefined ? "" : `:${String(target.line)}`
  return (
    <a className="outlink outlink--file" href={href} title={m.preview(`${path}${location}`)}
      onClick={(event) => {
        event.preventDefault()
        requestFilePreview(scope.threadId, scope.cwd, path, target)
      }}>
      <span className="outlink__icon"><FileIcon size={14} /></span>{children}
    </a>
  )
}

export function LinkedCode({ children, className }: { children?: ReactNode; className?: string }): React.JSX.Element {
  const inside = useContext(InsideLink)
  const linked = !inside && className === undefined && typeof children === "string" && inlineTarget(children)
  return <code className={className}>{linked ? <MessageLink href={children}>{children}</MessageLink> : children}</code>
}
