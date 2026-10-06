/**
 * Switchback 浏览器端的 service worker：**推送 + 外壳缓存**。
 *
 * ## 为什么要缓存外壳（这一条原来没有）
 *
 * 从主屏点开时，如果那一刻 Mac 睡着了、隧道断了、或者你在电梯里，
 * 看到的是**浏览器那张「无法打开页面」**——不是 Switchback 的界面配一条「正在重连…」。
 * 而后者才是这套东西该给的：界面在、状态说清楚、网一回来自己接上。
 *
 * **缓存的只是外壳，不是内容。** 内容全部来自那条实时连接，
 * 一个字节都不进缓存——缓存一份旧的会话正文只会让人对着过期状态发呆。
 * 所以 `/api/*` 这一层碰都不碰。
 *
 * ## 新鲜度怎么保证
 *
 * `/assets/` 下的文件名带内容哈希，由 `static.ts` 的 HTTP `immutable` 缓存负责；
 * service worker 不再另攒一份永不清理的哈希文件。导航本身永远先问网络，
 * 拿不到才退到一张独立的离线页；不缓存 `index.html`，
 * 因而不会把旧协议客户端带进一份已经更新的宿主。主进程给入口的 `no-cache`
 * 与这里说的是同一条契约。
 *
 * ## 为什么必须有它（推送那一半）
 *
 * Web Push 的消息只送到 service worker，页面关着也照收——这正是
 * 「人不在电脑前」这个场景需要的。iOS 上还有一条硬前提：
 * **必须先把页面加到主屏**，Safari 标签页里的 PWA 收不到推送。
 */

/**
 * 缓存名里带版本。
 *
 * **换版本是唯一的清理手段**：`activate` 时把名字对不上的整个删掉。
 * 不这么做的话，一个改过结构的旧缓存会一直躺在那儿，
 * 而它出问题的样子是「换了新包但界面还是旧的」——最难查的一类。
 */
const SHELL = "switchback-shell-v2"
const OFFLINE = "/offline.html"
const NAVIGATION_TIMEOUT_MS = 4000

/** 离线兜底必须自包含；正常应用资源继续使用静态服务层的 HTTP 缓存。 */
const ENTRY = [OFFLINE, "/manifest.webmanifest", "/icon.svg"]

self.addEventListener("install", (event) => {
  // 三份兜底都落稳之后才接管；少一份就让旧 worker 继续，不能安装半套离线页
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(ENTRY)).then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== SHELL).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

/** 网络真的不可达时给一张稳定的小页面；它不含任何旧会话或旧协议代码。 */
async function offlineResponse() {
  const cached = await caches.match(OFFLINE)
  return cached ?? new Response("Switchback 暂时连不上那台 Mac。", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  })
}

/** 在线导航要拿当前入口；睡眠中的隧道不能让冷启动在浏览器错误页前等几十秒。 */
async function navigate(req) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS)
  try {
    const response = await fetch(req, { signal: controller.signal })
    // 4xx 往往带着 Host/配置修复提示，应该原样给人；网关 5xx 才算暂时不可达
    if (response.status < 500) return response
  } catch {
    // 断网、隧道睡眠和主动超时统一走离线兜底
  } finally {
    clearTimeout(timeout)
  }
  return offlineResponse()
}

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return

  if (req.mode === "navigate") {
    event.respondWith(navigate(req))
    return
  }

  // 只缓存明确列入外壳的静态文件；普通路径交还浏览器，避免把 SPA 兜底页越攒越多
  if (!ENTRY.includes(url.pathname)) return
  event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)))
})

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // 推送服务偶尔会发一条空的「唤醒」消息，那不是我们的负载
  }
  const title = typeof data.title === "string" && data.title !== "" ? data.title : "Switchback"
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      // **同一条会话的通知互相替换**：一轮跑完接着来一张审批卡时，
      // 通知中心里不该堆两条，你要的是最新那一条
      tag: typeof data.threadId === "string" ? data.threadId : "switchback",
      renotify: true,
      data: { threadId: data.threadId },
      icon: "/icon.svg",
      badge: "/icon.svg",
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const threadId = event.notification.data && event.notification.data.threadId
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      // **先找已经开着的那一扇，别再开一扇。** 人要的是回到现场，
      // 而多开一个窗口意味着他手上那条正在读的会话被顶掉了
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus()
          client.postMessage({ type: "open-thread", threadId })
          return
        }
      }
      await self.clients.openWindow(threadId ? `/?thread=${encodeURIComponent(threadId)}` : "/")
    })(),
  )
})
