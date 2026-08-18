/**
 * omni 浏览器端的 service worker：**推送 + 外壳缓存**。
 *
 * ## 为什么要缓存外壳（这一条原来没有）
 *
 * 从主屏点开时，如果那一刻 Mac 睡着了、隧道断了、或者你在电梯里，
 * 看到的是**浏览器那张「无法打开页面」**——不是 omni 的界面配一条「正在重连…」。
 * 而后者才是这套东西该给的：界面在、状态说清楚、网一回来自己接上。
 *
 * **缓存的只是外壳，不是内容。** 内容全部来自那条实时连接，
 * 一个字节都不进缓存——缓存一份旧的会话正文只会让人对着过期状态发呆。
 * 所以 `/api/*` 这一层碰都不碰。
 *
 * ## 新鲜度怎么保证
 *
 * `/assets/` 下的文件名带内容哈希（`static.ts` 给它们发的是
 * `immutable`），所以**只进不出**：改了代码就是新文件名，自然 miss。
 * 而 `index.html` 走 stale-while-revalidate：先把缓存那份给出去（页面立刻有），
 * 同时在后台取一份新的写回缓存，下次打开就是新的。
 * 主进程给它的 `no-cache` 头保留不动——两层各管各的，别打架。
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
const SHELL = "omni-shell-v1"

/** 外壳的入口。带哈希的资源不在这里列——它们由 `fetch` 拦到时顺手存。 */
const ENTRY = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"]

self.addEventListener("install", (event) => {
  // **立刻接管**：不等下一次冷启动。旧的那个只管推送，没有状态要交接
  self.skipWaiting()
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(ENTRY).catch(() => undefined)))
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

/** 这一发能不能进缓存。**只有外壳**：内容和接口一律不碰。 */
function cacheable(url) {
  if (url.origin !== self.location.origin) return false
  if (url.pathname.startsWith("/api/")) return false
  return true
}

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (!cacheable(url)) return

  // 带哈希的资源：**缓存优先**。文件名变了自然 miss，所以不会拿到旧的
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            // 只存成功的那些：把一个 502 存进去，等于把「连不上」变成永久的
            if (res.ok) void caches.open(SHELL).then((c) => c.put(req, res.clone()))
            return res
          }),
      ),
    )
    return
  }

  // 导航和其余外壳：**先给缓存那份，后台再更新**。
  // 网断时这一条就是「界面还在」和「浏览器错误页」的差别
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL)
      const hit = await cache.match(req, { ignoreSearch: true })
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) void cache.put(req, res.clone())
          return res
        })
        .catch(() => undefined)
      // 缓存里有就立刻给，没有就只能等网络；两边都没有才是真的失败
      const res = hit ?? (await fresh)
      if (res !== undefined) return res
      return new Response("omni 还没缓存过界面，而且现在连不上。", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    })(),
  )
})

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // 推送服务偶尔会发一条空的「唤醒」消息，那不是我们的负载
  }
  const title = typeof data.title === "string" && data.title !== "" ? data.title : "omni"
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      // **同一条会话的通知互相替换**：一轮跑完接着来一张审批卡时，
      // 通知中心里不该堆两条，你要的是最新那一条
      tag: typeof data.threadId === "string" ? data.threadId : "omni",
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
