/**
 * 设备身份。
 *
 * 令牌存在 `localStorage`：这一端**没有** Electron 的 userData，也不该有 cookie——
 * cookie 会被浏览器自动附在每个请求上，于是就要防 CSRF；而放在 localStorage 里
 * 由代码显式带上，跨站的页面读不到它（同源策略），也没有「自动附带」这回事。
 */

/**
 * 令牌与设备名存在哪两个键上。**手机端与电脑端各一套**（`docs/远程模式方案.md` §2.3）。
 *
 * 两个界面挂在同一个源下（`/` 与 `/desk/`），共用一份 localStorage。共用一套键的话，
 * 在同一个浏览器里配一次电脑就把手机端的令牌顶掉了——而拿着手机端的令牌去开完整界面，
 * 每调一条通道都会被宿主拒（种类跟着令牌走，见 `main/remote/tokens.ts`）。
 */
export interface Slot {
  token: string
  name: string
}

export const WEB_SLOT: Slot = { token: "switchback.token", name: "switchback.device" }
export const DESK_SLOT: Slot = { token: "switchback.desk.token", name: "switchback.desk.device" }

/**
 * 改名（omni → Switchback）之前用的两个键。新键没有、旧键有，就挪过来一次——
 * 不然每台配对过的手机，在桌面端升级之后都会被莫名其妙踢回配对屏。
 * **只管手机端那一套**：改名那会儿还没有电脑端。
 */
const LEGACY: readonly (readonly [string, string])[] = [
  ["omni.token", WEB_SLOT.token],
  ["omni.device", WEB_SLOT.name],
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
  /** 这台设备的信任档上限（它自己的，没有就是宿主的默认）。界面据此说明「远程最高能到哪一档」。 */
  maxTrust: string
  /** 这台按什么配的。**老桌面不报**——那时按手机算，和宿主那侧的缺省一致。 */
  kind?: "phone" | "desk"
  /**
   * 引擎实际跑在哪台机器上。**老桌面不报这个字段**，那时整行不显示——
   * 不编一个「本机」出来（在手机上那三个字是错的）。
   */
  host?: string
  /**
   * 宿主那边的界面语言（`zh-CN` / `en`）。**老桌面不报**——那时按默认的中文。
   * 网页端跟着它走，不另设一份语言设置：手机和那台桌面说同一种话。
   */
  language?: string
}

export function tokenOf(slot: Slot = WEB_SLOT): string {
  try {
    adoptLegacy(window.localStorage)
    return window.localStorage.getItem(slot.token) ?? ""
  } catch {
    // Safari 的隐私模式会让 localStorage 直接抛。**不能因此白屏**——
    // 退回「没有令牌」，用户会看到配对页，虽然每次刷新都要重配
    return ""
  }
}

export function rememberToken(token: string, name: string, slot: Slot = WEB_SLOT): void {
  try {
    window.localStorage.setItem(slot.token, token)
    window.localStorage.setItem(slot.name, name)
  } catch {
    // 同上：存不下就存不下，这一次会话仍然是可用的
  }
}

export function forgetToken(slot: Slot = WEB_SLOT): void {
  try {
    window.localStorage.removeItem(slot.token)
    window.localStorage.removeItem(slot.name)
  } catch {
    // 忽略
  }
}

/**
 * 这台设备默认叫什么。用户可以改；这只是个不用动脑的初值。
 *
 * 手机和平板直接用型号；电脑上是「哪个系统上的浏览器」——这句话怎么说归界面（它知道用哪种语言），
 * 由 `browser` 给出，这一层只认系统。
 */
export function guessName(browser: (os: "Mac" | "Windows" | undefined) => string, slot: Slot = WEB_SLOT): string {
  try {
    adoptLegacy(window.localStorage)
    const saved = window.localStorage.getItem(slot.name)
    if (saved !== null && saved !== "") return saved
  } catch {
    // 忽略
  }
  const ua = window.navigator.userAgent
  if (/iPhone/.test(ua)) return "iPhone"
  if (/iPad/.test(ua)) return "iPad"
  if (/Android/.test(ua)) return "Android"
  if (/Macintosh/.test(ua)) return browser("Mac")
  if (/Windows/.test(ua)) return browser("Windows")
  return browser(undefined)
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
