import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.js"
import "./styles.css"

/**
 * 注册 service worker。**和推送无关，也不需要任何权限。**
 *
 * 它在这里缓存的是独立离线兜底：Mac 睡着、隧道断了、人在电梯里的时候，
 * 从主屏点开会明确看到“正在等那台 Mac”，而不是浏览器错误页；正常入口不缓存，
 * 以免宿主更新后仍完整运行一次旧协议客户端。
 *
 * 开推送时会再 `register` 一次（`push.ts`），那是幂等的——
 * 同一个 scope 的同一个脚本，浏览器认的是同一个注册。
 *
 * 失败一律吞掉：非安全上下文（明文 http 且不是 localhost）里
 * `serviceWorker` 整个不存在，而那时应用本身照常能用。
 */
function registerWorker(): void {
  if (!("serviceWorker" in navigator)) return
  void navigator.serviceWorker.register("/sw.js").catch(() => undefined)
}

registerWorker()

const el = document.getElementById("root")
if (el === null) throw new Error("omni web: 找不到 #root")

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
