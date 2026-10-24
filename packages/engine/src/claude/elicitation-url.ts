import type { ElicitationRequest } from "@anthropic-ai/claude-agent-sdk"
import type { QuestionPrompt } from "@switchback/protocol"
import { sanitize } from "./permission.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { CLAUDE_ELICITATION_URL } from "./elicitation-url.messages.js"

const MAX_URL = 4096
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"])

function serverLabel(request: ElicitationRequest): string {
  const server = sanitize(request.serverName) || "MCP"
  const display = sanitize(request.displayName ?? request.title ?? "")
  return display === "" || display === server ? server : `${display} · ${server}`
}

function warningOf(url: URL, m: (typeof CLAUDE_ELICITATION_URL)[Locale]): string | undefined {
  const warnings: string[] = []
  if (url.protocol === "http:" && !LOCAL.has(url.hostname)) {
    warnings.push(m.plainHttp)
  }
  if (url.hostname.toLowerCase().split(".").some((part) => part.startsWith("xn--"))) {
    warnings.push(m.punycode)
  }
  return warnings.length === 0 ? undefined : m.join(warnings)
}

function requestUrl(request: ElicitationRequest): string | undefined {
  if (typeof request.url !== "string" || request.url.length === 0 || request.url.length > MAX_URL) return undefined
  return typeof request.elicitationId === "string" && request.elicitationId.length > 0 ? request.url : undefined
}

function safeUrl(raw: string): URL | undefined {
  try {
    const url = new URL(raw)
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "") {
      return undefined
    }
    return url
  } catch {
    return undefined
  }
}

/** URL elicitation 只把可由系统浏览器安全接管的地址送进 UI；绝不请求或预取。 */
export function urlPrompt(request: ElicitationRequest, locale: Locale = DEFAULT_LOCALE): QuestionPrompt | undefined {
  const m = CLAUDE_ELICITATION_URL[locale]
  const raw = requestUrl(request)
  const url = raw === undefined ? undefined : safeUrl(raw)
  if (url === undefined) return undefined
  const warning = warningOf(url, m)
  return {
    id: "mcp-url",
    header: serverLabel(request),
    question: sanitize(request.message) || m.question,
    options: [{ id: "accept", label: m.accept }],
    ...(request.description === undefined ? {} : { body: sanitize(request.description) }),
    external: {
      url: url.toString(),
      ...(warning === undefined ? {} : { warning }),
    },
  }
}
