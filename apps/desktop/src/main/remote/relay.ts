import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { app } from "electron"
import type { ThreadId } from "@omni/protocol"
import type { Sinks } from "../sink.js"
import type { Logger } from "../log.js"
import { generateVapid, send, type Vapid } from "./push.js"
import type { TokenStore } from "./tokens.js"

/**
 * 「有人在等你」这件事往手机上送。
 *
 * ## 为什么这是这一端最要紧的一件事
 *
 * 没有推送，浏览器端只是一块**你得想起来去看**的远程屏幕。
 * 而这个应用的用法就是「交代一件事，然后去干别的」——「去干别的」常常是
 * 离开这台电脑。有了推送，它才是「在咖啡馆把卡住的那一轮放行」。
 *
 * ## 三条克制
 *
 * - **桌面窗口在前台就不推**（那时你就在电脑前）。这一条由 `attention.ts`
 *   的 `focused()` 决定，本文件收到的已经是过滤后的。
 * - **有客户端正看着这条会话就不推**。「某个窗口在前台」不等于「你看见了」，
 *   而「有人正开着这条会话的正文」才是。
 * - **正文里不放命令原文、不放代码、不放路径。** 内容虽然是端到端加密的
 *   （`push.ts` 干的就是这件事），但**端点在推送服务那儿**，
 *   而且通知会显示在锁屏上。等你打开应用再看细节。
 */

const VAPID_FILE = "remote-vapid.json"

export interface Relay {
  /** 推送用的公钥。前端拿它做 `applicationServerKey`。 */
  key: () => string
  /** 推一条。**不抛、不等**——一次推送失败不该影响任何别的事。 */
  notify: (threadId: ThreadId, title: string, body: string) => void
}

export interface RelayDeps {
  tokens: TokenStore
  sinks: Sinks
  log: Logger
  /**
   * 这台机器的 VAPID 密钥。**由调用方给**，不在这里读磁盘——
   * 读磁盘要 `electron` 的 `app`，而那会让这整个文件没法单独测，
   * 包括「推出去的东西对端解不解得开」这条最要紧的。
   */
  vapid: Vapid
}

function vapidPath(): string {
  return join(app.getPath("userData"), VAPID_FILE)
}

/**
 * 读出（或第一次生成）这台机器的 VAPID 密钥。
 *
 * **换了它，所有已订阅的设备都要重新订阅**，所以生成一次就存着。
 * `sub` 用一个 https 地址而不是真邮箱：推送服务只拿它当联系方式，
 * 而把用户的邮箱写进一个会发给第三方的 JWT 没有必要。
 */
export function loadVapid(log: Logger): Vapid {
  try {
    const raw = JSON.parse(readFileSync(vapidPath(), "utf8")) as Partial<Vapid>
    if (typeof raw.publicKey === "string" && typeof raw.privateKey === "string" && typeof raw.subject === "string") {
      return { publicKey: raw.publicKey, privateKey: raw.privateKey, subject: raw.subject }
    }
  } catch {
    // 没有这个文件是常态（第一次开推送）
  }
  const fresh = generateVapid("https://github.com/wzj1213/omni")
  try {
    writeFileSync(vapidPath(), `${JSON.stringify(fresh, null, 2)}\n`, "utf8")
  } catch (error) {
    // **存不下要吼**：下次启动会生成一把新的，而那会让所有设备的订阅静默失效
    log.write("error", "remote", `推送密钥写不进磁盘：${String(error)}`)
  }
  return fresh
}

export function createRelay(deps: RelayDeps): Relay {
  const vapid = deps.vapid

  /** 现在有没有客户端正开着这条会话的正文。 */
  const watched = (threadId: ThreadId): boolean =>
    deps.sinks.list().some((sink) => sink.watching?.() === threadId)

  return {
    key: () => vapid.publicKey,
    notify: (threadId, title, body) => {
      if (watched(threadId)) return
      const targets = deps.tokens.pushable()
      if (targets.length === 0) return
      const payload = JSON.stringify({ threadId, title, body })
      for (const target of targets) {
        void send({ vapid, sub: target.push, payload, now: Date.now() }).then((result) => {
          if (result.ok) return
          if (result.gone) {
            // 订阅死了（卸了 PWA、清了站点数据、服务端过期）。**删掉**——
            // 留着只会每次都白发一次请求，日志里一直是同一条错误
            deps.tokens.setPush(target.id, undefined)
            deps.log.write("info", "remote", `${target.name} 的推送订阅已失效，摘掉`)
            return
          }
          deps.log.write("warn", "remote", `推给 ${target.name} 失败：HTTP ${String(result.status)}`)
        })
      }
    },
  }
}
