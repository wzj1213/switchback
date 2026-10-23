import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { DESK_SLOT, tokenOf, whoAmI } from "@switchback/link"
import { remoteBridge } from "./bridge.js"
import { createConnection } from "./connection.js"
import { Pair, type PairReason } from "./Pair.js"
import { RemoteBar } from "./RemoteBar.js"
import { documentLocale } from "../i18n.js"
import { REMOTE_BOOT } from "./boot.messages.js"

/**
 * 远程窗口的启动（`docs/远程模式方案.md`）。
 *
 * ## 什么时候算远程窗口
 *
 * **没有 preload、而且页面是从 `/desk/` 送出来的**。两个条件缺一不可：
 * 只看「没有 preload」的话，preload 坏了的本机窗口会被当成远程窗口、弹一个配对屏——
 * 那会把「桥断了」这个真故障藏起来（`useSwitchback` 的 `bridgeMissing` 本来要把它说出来）。
 *
 * ## 先问「我是谁」，再挂界面
 *
 * 一次往返换三件事：令牌还认不认（不认 → 配对屏）、这台是按电脑还是手机配的
 *（手机的令牌开完整界面只会处处被拒 → 也给配对屏，并说清为什么）、引擎跑在哪台机器上。
 * **问不出来（网络）不等于不认**：照样挂界面，连接条会说「正在连」，传输层自己重试。
 */
export function isRemoteWindow(): boolean {
  return window.switchback === undefined && /^\/desk(\/|$)/u.test(window.location.pathname)
}

function renderPair(root: HTMLElement, reason: PairReason): void {
  createRoot(root).render(
    <StrictMode>
      <Pair reason={reason} />
    </StrictMode>,
  )
}

/**
 * 挂远程窗口。`app` 是本机窗口挂的同一棵树——**一行不改**，差别全在 `window.switchback` 底下。
 * 返回之前 `window.switchback` 已经装好：界面第一次渲染就要读它。
 */
export async function bootRemote(root: HTMLElement, app: React.JSX.Element): Promise<void> {
  const token = tokenOf(DESK_SLOT)
  if (token === "") {
    renderPair(root, "fresh")
    return
  }
  const seen = await whoAmI(token)
  if (seen.kind === "denied") {
    renderPair(root, "expired")
    return
  }
  if (seen.kind === "ok" && seen.me.kind !== "desk") {
    renderPair(root, "phone")
    return
  }
  const host = seen.kind === "ok" && seen.me.host !== undefined ? seen.me.host : REMOTE_BOOT[documentLocale()].host
  const conn = createConnection(token)
  window.switchback = remoteBridge(conn, host)
  // **远程窗口里没人接住的失败要说出来。** 界面各处对桥的调用大多是 `void x().then(…)`——
  // 同机 IPC 上几乎不会失败，这里会：被宿主拒（「只能在那台机器上做」）、断线（「这一下没有做完」）、
  // 超时。不接的话那一下就是「点了没反应」，连接条是唯一说得出原因的地方
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason
    if (reason instanceof Error && reason.message !== "") conn.say(reason.message)
  })
  // 标签页上写清楚这是哪台：两台各开一个窗口时，分不清的代价是在错的那台上点了「允许」
  document.title = `Switchback · ${host}`
  createRoot(root).render(
    <>
      {app}
      <RemoteBar conn={conn} />
    </>,
  )
}
