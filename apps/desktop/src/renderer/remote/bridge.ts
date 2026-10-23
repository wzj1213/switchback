import type { SwitchbackBridge } from "../../preload/index.js"
import type { Connection } from "./connection.js"
import { hostOnly, local } from "./bridge-local.js"
import type { RemoteExtras } from "./types.js"
import { documentLocale } from "../i18n.js"
import { REMOTE_BRIDGE } from "./bridge.messages.js"

/**
 * 远程窗口里的 `window.switchback`：**形状与 preload 一模一样**，底下走的是 WebSocket。
 *
 * 三类方法：
 *
 * - **事件流**（`send` / `subscribe` / `onReplay` / `hello` / `resync` / `viewing`）——接到 `Connection`；
 * - **宿主通道**——一条 `call`，通道名与参数形状**逐字照抄 preload**：宿主调的是同一个处理函数
 *  （`main/channels.ts`），参数差一个字段它就读到 undefined；
 * - **只在本机有意义的**——剪贴板用这台的，弹框、访达、系统编辑器这类在 `bridge-local.ts`。
 *
 * 类型是 `SwitchbackBridge`（preload 的真实导出）：preload 多一个方法，这里就编译不过，
 * 不会出现「远程窗口里那颗按钮 is not a function」。
 */
type Bridge = SwitchbackBridge
type Out<K extends keyof Bridge> = Bridge[K] extends (...args: never[]) => infer R ? R : never

function ask<K extends keyof Bridge>(conn: Connection, channel: string, arg?: unknown): Out<K> {
  return conn.call(channel, arg) as Out<K>
}

/** 发出去不等回话的那几条：失败也只能吞掉——preload 那边本来就是 `ipcRenderer.send`。 */
function tell(conn: Connection, channel: string, arg: unknown): void {
  void conn.call(channel, arg).catch(() => undefined)
}

function stream(conn: Connection): Pick<Bridge, "send" | "viewing" | "hello" | "subscribe" | "onReplay" | "resync"> {
  return {
    send: (command) => {
      // 没连上时这一下会丢：**说出来**，别让人以为点了「允许」就放行了
      if (!conn.send(command)) conn.say(REMOTE_BRIDGE[documentLocale()].notSent)
    },
    viewing: (threadId) => {
      conn.watch(threadId ?? null)
    },
    hello: conn.start,
    subscribe: conn.onEvents,
    onReplay: conn.onReplay,
    resync: conn.resync,
  }
}

function reads(conn: Connection) {
  return {
    settings: (patch) => ask<"settings">(conn, "switchback:settings", patch),
    appInfo: () => ask<"appInfo">(conn, "switchback:appInfo"),
    worksite: (threadId, cwd) => ask<"worksite">(conn, "switchback:worksite", { threadId, cwd }),
    workReview: (cwd, threadId, wanted, scope) =>
      ask<"workReview">(conn, "switchback:workReview", { cwd, threadId, wanted, scope }),
    workPatch: (cwd, rel, query) => ask<"workPatch">(conn, "switchback:workPatch", { cwd, rel, ...query }),
    gitState: (req) => ask<"gitState">(conn, "switchback:gitState", req),
    searchThreads: (query) => ask<"searchThreads">(conn, "switchback:searchThreads", query),
    searchFiles: (cwd, query, refresh) => ask<"searchFiles">(conn, "switchback:searchFiles", { cwd, query, refresh }),
    filePreview: (threadId, cwd, path) => ask<"filePreview">(conn, "switchback:filePreview", { threadId, cwd, path }),
    projectDoc: (threadId, cwd) => ask<"projectDoc">(conn, "switchback:projectDoc", { threadId, cwd }),
    thumb: (path, max) => ask<"thumb">(conn, "switchback:thumb", { path, max }),
    activity: (refresh) => ask<"activity">(conn, "switchback:activity", refresh),
    engineVersions: (refresh) => ask<"engineVersions">(conn, "switchback:engineVersions", refresh),
    engineDoors: (cwd, dshProfile) => ask<"engineDoors">(conn, "switchback:engineDoors", { cwd, dshProfile }),
    dshProfiles: () => ask<"dshProfiles">(conn, "switchback:dshProfiles"),
    envConfig: (cwd) => ask<"envConfig">(conn, "switchback:envConfig", cwd),
    guard: () => ask<"guard">(conn, "switchback:guard"),
    loadDrafts: () => ask<"loadDrafts">(conn, "switchback:drafts/load"),
  } satisfies Partial<Bridge>
}

function writes(conn: Connection) {
  return {
    gitCommit: (req) => ask<"gitCommit">(conn, "switchback:gitCommit", req),
    gitStage: (req) => ask<"gitStage">(conn, "switchback:gitStage", req),
    gitUndo: (req) => ask<"gitUndo">(conn, "switchback:gitUndo", req),
    ensureProjectDoc: (threadId, cwd) => ask<"ensureProjectDoc">(conn, "switchback:ensureProjectDoc", { threadId, cwd }),
    stashImage: (mime, bytes) => ask<"stashImage">(conn, "switchback:stashImage", { mime, bytes }),
    discardImages: (paths) => {
      tell(conn, "switchback:discardImages", paths)
    },
    saveDraft: (key, draft) => {
      tell(conn, "switchback:drafts/save", { key, draft })
    },
    chatDir: () => ask<"chatDir">(conn, "switchback:chatDir"),
  } satisfies Partial<Bridge>
}

/** 装进 `window.switchback` 的那一份。 */
export function remoteBridge(conn: Connection, host: string): Bridge & RemoteExtras {
  const bridge: Bridge = {
    ...hostOnly(conn),
    ...local(conn, host),
    ...stream(conn),
    ...reads(conn),
    ...writes(conn),
  }
  return { ...bridge, remoteHost: host, onHistory: conn.onHistory, bodies: conn.bodies }
}
