export type LinkPart = { kind: "text"; text: string } | { kind: "link"; text: string; href: string }

const URL_SOURCE = String.raw`https?:\/\/[^\s<>"'，。；：！？、]+`
const TRAILING = /[.,;:!，。；：！、]+$/u
const BRACKETS = [
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ["（", "）"],
  ["【", "】"],
] as const

function count(text: string, needle: string): number {
  return text.split(needle).length - 1
}

/** 句末标点不属于 URL；URL 自己成对的括号则保留。 */
function urlEnd(raw: string): number {
  const withoutPunctuation = raw.replace(TRAILING, "")
  let end = withoutPunctuation.length
  for (const [open, close] of BRACKETS) {
    while (withoutPunctuation.slice(0, end).endsWith(close)) {
      const value = withoutPunctuation.slice(0, end)
      if (count(value, close) <= count(value, open)) break
      end -= close.length
    }
  }
  return end
}

/** 只把 http(s) URL 变成链接；其余字面量逐字保留。 */
export function linkParts(text: string): readonly LinkPart[] {
  const parts: LinkPart[] = []
  let cursor = 0
  for (const match of text.matchAll(new RegExp(URL_SOURCE, "giu"))) {
    const at = match.index
    const raw = match[0]
    const end = urlEnd(raw)
    if (at > cursor) parts.push({ kind: "text", text: text.slice(cursor, at) })
    parts.push({ kind: "link", text: raw.slice(0, end), href: raw.slice(0, end) })
    if (end < raw.length) parts.push({ kind: "text", text: raw.slice(end) })
    cursor = at + raw.length
  }
  if (cursor < text.length) parts.push({ kind: "text", text: text.slice(cursor) })
  return parts.length === 0 ? [{ kind: "text", text }] : parts
}

export function isGitHubLink(href: string): boolean {
  return /^https?:\/\/(?:www\.)?github\.com(?:[/:?#]|$)/iu.test(href)
}
