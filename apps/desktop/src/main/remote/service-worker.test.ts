import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import { describe, expect, it, vi } from "vitest"

interface WorkerEvent {
  request?: { method: string; mode: string; url: string }
  respondWith?: (response: Promise<Response>) => void
  waitUntil?: (work: Promise<unknown>) => void
}

type WorkerHandler = (event: WorkerEvent) => void

const SOURCE = readFileSync(
  fileURLToPath(new URL("../../../../web/public/sw.js", import.meta.url)),
  "utf8",
)

function worker(fetcher: (request: unknown, init?: unknown) => Promise<Response>) {
  const listeners = new Map<string, WorkerHandler>()
  const addAll = vi.fn(() => Promise.resolve())
  const skipWaiting = vi.fn(() => Promise.resolve())
  const match = vi.fn((request: unknown) => {
    if (request === "/offline.html") return Promise.resolve(new Response("offline"))
    return Promise.resolve(new Response("stale index"))
  })
  const self = {
    location: { origin: "https://omni.test" },
    clients: { claim: () => Promise.resolve() },
    registration: { showNotification: () => Promise.resolve() },
    skipWaiting,
    addEventListener: (type: string, handler: WorkerHandler) => listeners.set(type, handler),
  }
  runInNewContext(SOURCE, {
    AbortController,
    Promise,
    Response,
    URL,
    caches: {
      keys: () => Promise.resolve([]),
      delete: () => Promise.resolve(true),
      match,
      open: () => Promise.resolve({ addAll, put: () => Promise.resolve() }),
    },
    clearTimeout,
    fetch: fetcher,
    self,
    setTimeout,
  })
  return { addAll, listeners, match, skipWaiting }
}

async function navigate(fetcher: () => Promise<Response>): Promise<Response> {
  const harness = worker(fetcher)
  const state: { response?: Promise<Response> } = {}
  harness.listeners.get("fetch")?.({
    request: { method: "GET", mode: "navigate", url: "https://omni.test/?thread=keep" },
    respondWith: (response) => { state.response = response },
  })
  if (state.response === undefined) throw new Error("service worker 没有接管导航")
  return state.response
}

describe("Web service worker 外壳", () => {
  it("安装只预缓存独立离线页，不缓存会运行旧协议代码的入口", async () => {
    const harness = worker(() => Promise.resolve(new Response("ok")))
    const state: { work?: Promise<unknown> } = {}
    harness.listeners.get("install")?.({ waitUntil: (work) => { state.work = work } })
    await state.work

    expect(harness.addAll).toHaveBeenCalledWith([
      "/offline.html",
      "/manifest.webmanifest",
      "/icon.svg",
    ])
    expect(harness.skipWaiting).toHaveBeenCalledOnce()
  })

  it("带哈希应用资源交回 HTTP immutable 缓存，不在 worker 缓存里只增不减", () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response("asset")))
    const respondWith = vi.fn()
    const harness = worker(fetcher)
    harness.listeners.get("fetch")?.({
      request: { method: "GET", mode: "cors", url: "https://omni.test/assets/index-current.js" },
      respondWith,
    })

    expect(respondWith).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    { label: "在线升级", fetcher: () => Promise.resolve(new Response("current", { status: 200 })), text: "current", status: 200 },
    { label: "Host 配置错误", fetcher: () => Promise.resolve(new Response("fix host", { status: 403 })), text: "fix host", status: 403 },
    { label: "网关故障", fetcher: () => Promise.resolve(new Response("bad gateway", { status: 502 })), text: "offline", status: 200 },
    { label: "完全断网", fetcher: () => Promise.reject(new Error("offline")), text: "offline", status: 200 },
  ])("$label 时选择正确导航响应", async ({ fetcher, text, status }) => {
    const response = await navigate(fetcher)
    expect(response.status).toBe(status)
    expect(await response.text()).toBe(text)
  })
})
