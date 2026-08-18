/**
 * omni 浏览器端的 service worker。**只干推送这一件事。**
 *
 * 不做离线缓存：这一端的全部内容都来自一条实时连接，缓存一份旧的界面
 * 只会让人对着一屏过期的状态发呆。静态资源的缓存由 HTTP 头管
 *（见主进程的 `remote/static.ts`），那一层够了。
 *
 * ## 为什么必须有它
 *
 * Web Push 的消息只送到 service worker，页面关着也照收——这正是
 * 「人不在电脑前」这个场景需要的。iOS 上还有一条硬前提：
 * **必须先把页面加到主屏**，Safari 标签页里的 PWA 收不到推送。
 */

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
