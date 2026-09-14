import { canonicalPath } from "../shared/paths.js"

export type MessageTarget =
  | { kind: "external"; href: string }
  | { kind: "file"; path: string; line?: number; column?: number; fragment?: string }
  | { kind: "fragment"; fragment: string }
  | { kind: "unsupported" }

const UNSUPPORTED = { kind: "unsupported" } as const
const LOCATION = /(?::(\d+)(?::(\d+))?|#L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?)$/i

function decoded(text: string): string {
  try { return decodeURIComponent(text) } catch { return text }
}

function coordinates(location: RegExpExecArray | null): { line?: number; column?: number } {
  const line = Number(location?.[1] ?? location?.[3])
  const column = Number(location?.[2] ?? location?.[4])
  return {
    ...(Number.isSafeInteger(line) && line > 0 ? { line } : {}),
    ...(Number.isSafeInteger(column) && column > 0 ? { column } : {}),
  }
}

function fileTarget(raw: string): MessageTarget {
  const location = LOCATION.exec(raw)
  const path = location === null ? raw : raw.slice(0, location.index)
  const hash = path.indexOf("#")
  const base = hash === -1 ? path : path.slice(0, hash)
  if (base === "") return UNSUPPORTED
  return { kind: "file", path: decoded(base), ...coordinates(location),
    ...(hash === -1 ? {} : { fragment: decoded(path.slice(hash + 1)) }),
  }
}

function externalTarget(raw: string): MessageTarget {
  try {
    return { kind: "external", href: new URL(raw.startsWith("//") ? `https:${raw}` : raw).href }
  } catch { return UNSUPPORTED }
}

function fileUrlTarget(raw: string): MessageTarget {
  try {
    const url = new URL(raw)
    if (url.hostname !== "" && url.hostname !== "localhost") return UNSUPPORTED
    const path = url.pathname.replace(/^\/([A-Za-z]:\/)/, "$1")
    return fileTarget(`${path}${url.hash}`)
  } catch { return UNSUPPORTED }
}

function unsupportedScheme(raw: string): boolean {
  if (/^[a-z]:[/\\]/i.test(raw)) return false
  // 文件名后带行号也包含冒号，不能把 manager.py:42 当作 URI 协议。
  if (/^[^:]+\.[^:]+:\d+(?::\d+)?$/.test(raw)) return false
  return /^[a-z][a-z\d+.-]*:/i.test(raw)
}

/** 只分流可展示的链接；本地文件的最终读取权限仍由主进程验证。 */
export function messageTarget(href: string): MessageTarget {
  const raw = href.trim()
  if (raw === "" || [...raw].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return UNSUPPORTED
  if (raw.startsWith("#")) return { kind: "fragment", fragment: decoded(raw.slice(1)) }
  if (/^(?:https?:|mailto:)/i.test(raw) || raw.startsWith("//")) return externalTarget(raw)
  if (/^file:/i.test(raw)) return fileUrlTarget(raw)
  return unsupportedScheme(raw) ? UNSUPPORTED : fileTarget(raw)
}

/** 行内代码只识别完整 URL 或明确文件名，不把命令、版本号和表达式变成链接。 */
export function inlineTarget(text: string): boolean {
  if (text.includes("\n") || text !== text.trim()) return false
  if (/^(?:https?:\/\/|file:\/\/)/i.test(text)) return !/\s/.test(text) && messageTarget(text).kind !== "unsupported"
  return /^(?:\.?\.?[/\\]|[A-Za-z]:[/\\])[^\s<>|;&]+$/.test(text)
    || /^[^\s<>:|;&]+\.(?:tsx?|jsx?|py|go|rs|md|txt|html?|css|json|ya?ml|toml|sh)(?::\d+(?::\d+)?|#L\d+)?$/i.test(text)
}

export function resolveMessagePath(path: string, cwd: string, documentPath?: string): string {
  const base = documentPath === undefined ? cwd : canonicalPath(documentPath, cwd).replace(/\/[^/]*$/, "")
  return canonicalPath(path, base)
}

export function headingSlug(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-")
}
