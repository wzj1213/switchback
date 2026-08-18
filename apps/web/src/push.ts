/**
 * 订阅推送。
 *
 * ## iOS 上的三条硬前提（每一条都会静默失败）
 *
 * 1. **必须先加到主屏。** Safari 标签页里的 PWA 收不到推送，
 *    `Notification.requestPermission()` 甚至可能直接不存在。
 * 2. **必须在用户手势里请求权限。** 页面加载时自动问会被直接拒，
 *    而且**没有第二次机会**——用户之后想开也开不了，只能删掉再重装。
 *    所以这一段只在按钮的 click 里跑。
 * 3. **必须是 https。** 回环（localhost）也算安全上下文，但隧道那头
 *    如果是明文 http，`serviceWorker` 整个不存在。
 *
 * 三条都不满足时**说清楚是哪一条**，而不是回一个「开启失败」。
 */

export type PushState =
  /** 这个环境压根不支持（不是安全上下文、没加主屏、浏览器太老）。 */
  | { kind: "unsupported"; why: string }
  | { kind: "off" }
  | { kind: "on" }
  /** 用户拒过了。**浏览器不给第二次机会**，只能去系统设置里改。 */
  | { kind: "denied" }
  | { kind: "working" }

/** 现在是什么状态。**只读，不请求权限**——请求必须在用户手势里。 */
export async function pushState(): Promise<PushState> {
  const why = unsupportedWhy()
  if (why !== undefined) return { kind: "unsupported", why }
  if (Notification.permission === "denied") return { kind: "denied" }
  const registration = await navigator.serviceWorker.getRegistration()
  const sub = await registration?.pushManager.getSubscription()
  return sub === null || sub === undefined ? { kind: "off" } : { kind: "on" }
}

function unsupportedWhy(): string | undefined {
  if (!window.isSecureContext) return "这个地址不是 https，浏览器不给推送"
  if (!("serviceWorker" in navigator)) return "这个浏览器没有 service worker"
  if (!("PushManager" in window)) return "这个浏览器不支持 Web Push"
  if (!("Notification" in window)) return "这个浏览器不支持通知"
  // iOS：只有加到主屏之后 standalone 才为真，而标签页里的 PWA 收不到推送
  const standalone = window.matchMedia("(display-mode: standalone)").matches
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true
  const ios = /iPhone|iPad|iPod/.test(window.navigator.userAgent)
  if (ios && !standalone && !iosStandalone) return "iPhone 上要先「分享 → 添加到主屏幕」，标签页里收不到推送"
  return undefined
}

/**
 * base64url 的公钥 → `applicationServerKey` 要的字节。
 *
 * 返回 `ArrayBuffer` 而不是 `Uint8Array`：后者的 `buffer` 在 TS 的类型里
 * 可能是 `SharedArrayBuffer`，而这个 API 只收普通的那种。
 */
function keyBytes(base64url: string): ArrayBuffer {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/")
  const raw = window.atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
  const out = new ArrayBuffer(raw.length)
  const view = new Uint8Array(out)
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i)
  return out
}

/** `PushSubscription` → 服务端要的三个字段。 */
function shapeOf(sub: PushSubscription): { endpoint: string; p256dh: string; auth: string } | undefined {
  const json = sub.toJSON()
  const keys = json.keys
  if (keys?.p256dh === undefined || keys.auth === undefined) return undefined
  return { endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth }
}

export type EnableResult = { ok: true } | { ok: false; reason: string }

/** **必须在用户手势里调**（见文件头第 2 条）。 */
export async function enablePush(token: string): Promise<EnableResult> {
  const why = unsupportedWhy()
  if (why !== undefined) return { ok: false, reason: why }
  const granted = await Notification.requestPermission()
  if (granted !== "granted") return { ok: false, reason: "你拒绝了通知权限。浏览器不会再问第二次，要开得去系统设置里改。" }

  const registration = await navigator.serviceWorker.register("/sw.js")
  const res = await fetch("/api/push/key")
  const { key } = (await res.json()) as { key: string }
  if (typeof key !== "string" || key === "") return { ok: false, reason: "omni 没给出推送公钥" }

  const sub = await registration.pushManager.subscribe({
    // **只能是 true**：Chrome 会拒掉静默推送，而 iOS 压根没有静默这一档
    userVisibleOnly: true,
    applicationServerKey: keyBytes(key),
  })
  const shape = shapeOf(sub)
  if (shape === undefined) return { ok: false, reason: "浏览器给的订阅缺字段" }

  const saved = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(shape),
  })
  if (!saved.ok) return { ok: false, reason: `omni 没存下这个订阅（HTTP ${String(saved.status)}）` }
  return { ok: true }
}

/** 退订。**两头都要退**：只退浏览器那头的话，omni 还会一直往一个死端点推。 */
export async function disablePush(token: string): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration()
  const sub = await registration?.pushManager.getSubscription()
  await sub?.unsubscribe()
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  })
}
