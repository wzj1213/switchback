import { linkParts } from "../links.js"
import { ExternalLink } from "./external-link.js"

/** 用户消息保持字面量，只把明确的 http(s) URL 变成可点外链。 */
export function LinkifiedText({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {linkParts(text).map((part, index) =>
        part.kind === "link" ? (
          <ExternalLink href={part.href} key={`${String(index)}-${part.href}`}>
            {part.text}
          </ExternalLink>
        ) : (
          <span key={String(index)}>{part.text}</span>
        ),
      )}
    </>
  )
}
