/**
 * 设备身份。
 *
 * 令牌存在 `localStorage`：这一端**没有** Electron 的 userData，也不该有 cookie——
 * cookie 会被浏览器自动附在每个请求上，于是就要防 CSRF；而放在 localStorage 里
 * 由代码显式带上，跨站的页面读不到它（同源策略），也没有「自动附带」这回事。
 */

const KEY = "omni.token"
const NAME_KEY = "omni.device"

export interface Me {
  id: string
  name: string
  /** 这条连接的信任档上限。界面据此说明「远程最高能到哪一档」。 */
  maxTrust: string
}

export function tokenOf(): string {
  try {
    return window.localStorage.getItem(KEY) ?? ""
  } catch {
    // Safari 的隐私模式会让 localStorage 直接抛。**不能因此白屏**——
    // 退回「没有令牌」，用户会看到配对页，虽然每次刷新都要重配
    return ""
  }
}

export function rememberToken(token: string, name: string): void {
  try {
    window.localStorage.setItem(KEY, token)
    window.localStorage.setItem(NAME_KEY, name)
  } catch {
    // 同上：存不下就存不下，这一次会话仍然是可用的
  }
}

export function forgetToken(): void {
  try {
    window.localStorage.removeItem(KEY)
    window.localStorage.removeItem(NAME_KEY)
  } catch {
    // 忽略
  }
}

/** 这台设备默认叫什么。用户可以改；这只是个不用动脑的初值。 */
export function guessName(): string {
  try {
    const saved = window.localStorage.getItem(NAME_KEY)
    if (saved !== null && saved !== "") return saved
  } catch {
    // 忽略
  }
  const ua = window.navigator.userAgent
  if (/iPhone/.test(ua)) return "iPhone"
  if (/iPad/.test(ua)) return "iPad"
  if (/Android/.test(ua)) return "Android"
  if (/Macintosh/.test(ua)) return "Mac 上的浏览器"
  if (/Windows/.test(ua)) return "Windows 上的浏览器"
  return "浏览器"
}

/** 令牌还认吗。顺带拿回这条连接的上限档位。认不出返回 undefined。 */
export async function whoAmI(token: string): Promise<Me | undefined> {
  if (token === "") return undefined
  const res = await fetch("/api/me", { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) return undefined
  return (await res.json()) as Me
}

export type PairResult = { ok: true; token: string; name: string } | { ok: false; reason: string }

/** 拿配对码换一个长期令牌。 */
export async function pair(code: string, name: string): Promise<PairResult> {
  const res = await fetch("/api/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name }),
  })
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string }
  if (!res.ok || typeof body.token !== "string") {
    return { ok: false, reason: body.error ?? `配对失败（HTTP ${String(res.status)}）` }
  }
  return { ok: true, token: body.token, name }
}
