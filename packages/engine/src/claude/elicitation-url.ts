import type { ElicitationRequest } from "@anthropic-ai/claude-agent-sdk"
import type { QuestionPrompt } from "@omni/protocol"
import { sanitize } from "./permission.js"

const MAX_URL = 4096
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"])

function serverLabel(request: ElicitationRequest): string {
  const server = sanitize(request.serverName) || "MCP"
  const display = sanitize(request.displayName ?? request.title ?? "")
  return display === "" || display === server ? server : `${display} · ${server}`
}

function warningOf(url: URL): string | undefined {
  const warnings: string[] = []
  if (url.protocol === "http:" && !LOCAL.has(url.hostname)) {
    warnings.push("这不是 HTTPS 地址，提交敏感信息前请确认连接是否可信")
  }
  if (url.hostname.toLowerCase().split(".").some((part) => part.startsWith("xn--"))) {
    warnings.push("域名包含 Punycode（xn--），请仔细核对，避免相似域名欺骗")
  }
  return warnings.length === 0 ? undefined : warnings.join("；")
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
export function urlPrompt(request: ElicitationRequest): QuestionPrompt | undefined {
  const raw = requestUrl(request)
  const url = raw === undefined ? undefined : safeUrl(raw)
  if (url === undefined) return undefined
  const warning = warningOf(url)
  return {
    id: "mcp-url",
    header: serverLabel(request),
    question: sanitize(request.message) || "是否同意前往这个地址？",
    options: [{ id: "accept", label: "我已核对地址，同意继续" }],
    ...(request.description === undefined ? {} : { body: sanitize(request.description) }),
    external: {
      url: url.toString(),
      ...(warning === undefined ? {} : { warning }),
    },
  }
}
