import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { KIMI_HTTP } from "./http.messages.js"

interface Envelope<T> {
  code: number
  msg: string
  data: T
  request_id?: string
  details?: unknown
}

export class KimiApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = "KimiApiError"
  }
}

export interface KimiApi {
  get: <T>(path: string) => Promise<T>
  post: <T>(path: string, body?: unknown) => Promise<T>
}

export type KimiFetch = typeof fetch

const REQUEST_MS = 30_000

function apiPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`
}

async function envelope<T>(response: Response, m: (typeof KIMI_HTTP)[Locale]): Promise<T> {
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new KimiApiError(response.status, m.unparseable(response.status))
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new KimiApiError(response.status, m.badEnvelope(response.status))
  }
  const raw = parsed as Partial<Envelope<T>>
  if (!response.ok || raw.code !== 0) {
    const code = typeof raw.code === "number" ? raw.code : response.status
    throw new KimiApiError(code, raw.msg || `HTTP ${String(response.status)}`, raw.details)
  }
  return raw.data as T
}

/** token 只关在闭包里，不进错误、日志或 URL。 */
export function createKimiApi(
  baseUrl: string,
  token: string,
  fetcher: KimiFetch = fetch,
  locale: () => Locale = () => DEFAULT_LOCALE,
): KimiApi {
  const request = async <T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> => {
    const hasBody = body !== undefined
    const response = await fetcher(apiPath(baseUrl, path), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_MS),
    })
    return envelope<T>(response, KIMI_HTTP[locale()])
  }
  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  }
}

export function sessionPath(id: string, tail = ""): string {
  return `sessions/${encodeURIComponent(id)}${tail}`
}
