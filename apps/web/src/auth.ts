/**
 * 设备身份。
 *
 * 令牌存在 `localStorage`：这一端**没有** Electron 的 userData，也不该有 cookie——
 * cookie 会被浏览器自动附在每个请求上，于是就要防 CSRF；而放在 localStorage 里
 * 由代码显式带上，跨站的页面读不到它（同源策略），也没有「自动附带」这回事。
 */

const KEY = "switchback.token"
const NAME_KEY = "switchback.device"

/**
 * 改名（omni → Switchback）之前用的两个键。新键没有、旧键有，就挪过来一次——
 * 不然每台配对过的手机，在桌面端升级之后都会被莫名其妙踢回配对屏。
 */
const LEGACY: readonly (readonly [string, string])[] = [
  ["omni.token", KEY],
  ["omni.device", NAME_KEY],
]

/** 把旧键的值挪到新键上。新键已经有值时只删旧键，不覆盖。 */
export function adoptLegacy(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): void {
  for (const [old, now] of LEGACY) {
    const value = storage.getItem(old)
    if (value === null) continue
    if (storage.getItem(now) === null) storage.setItem(now, value)
    storage.removeItem(old)
  }
}

export interface Me {
  id: string
  name: string
  /** 这条连接的信任档上限。界面据此说明「远程最高能到哪一档」。 */
  maxTrust: string
  /**
   * 引擎实际跑在哪台机器上。**老桌面不报这个字段**，那时整行不显示——
   * 不编一个「本机」出来（在手机上那三个字是错的）。
   */
  host?: string
}

export function tokenOf(): string {
  try {
    adoptLegacy(window.localStorage)
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
    adoptLegacy(window.localStorage)
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

/**
 * 令牌还认吗。三态，**不能压成两态**：
 *
 * - `ok` —— 认得出，顺带拿回这条连接的上限档位
 * - `denied` —— 401/403，令牌真的不认了（被吊销、或者换了机器）
 * - `unknown` —— 网络错了、或者中间的反向代理回了 502/504
 *
 * 把第三种也当成「被吊销」的代价很具体：隧道那头的 nginx 在 ssh 重连的
 * 十几秒里回 502，用户就被踢回配对屏，还以为自己的设备被谁删了。
 * 而它其实只需要再等十秒。
 */
export type WhoAmI = { kind: "ok"; me: Me } | { kind: "denied" } | { kind: "unknown"; reason: string }

export async function whoAmI(token: string): Promise<WhoAmI> {
  if (token === "") return { kind: "denied" }
  let res: Response
  try {
    res = await fetch("/api/me", { headers: { authorization: `Bearer ${token}` } })
  } catch (error) {
    return { kind: "unknown", reason: error instanceof Error ? error.message : "连不上" }
  }
  if (res.status === 401 || res.status === 403) return { kind: "denied" }
  if (!res.ok) return { kind: "unknown", reason: `HTTP ${String(res.status)}` }
  try {
    return { kind: "ok", me: (await res.json()) as Me }
  } catch (error) {
    return { kind: "unknown", reason: error instanceof Error ? error.message : "回的不是 JSON" }
  }
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
