import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { app, ipcMain } from "electron"
import type { Command, Event, Trust } from "@switchback/protocol"
import type { Ledger } from "@switchback/wire"
import type { Handler } from "../channels.js"
import type { Sink, Sinks } from "../sink.js"
import type { Logger } from "./../log.js"
import type { Settings } from "../../shared/settings.js"
import { assertTrustedAuthority } from "./fence.js"
import { createTokenStore, type Device, type DeviceKind } from "./tokens.js"
import { startRemote, type RemoteServer } from "./server.js"
import { createRelay, loadVapid, type Relay } from "./relay.js"

/**
 * 把远程服务端接到应用上：设备表落盘、按设置起停、给设置面板开几条窄通道。
 *
 * 单独一个文件是为了让 `index.ts` 只多一行——那个文件已经是启动顺序的账本了，
 * 再往里塞一坨条件启动逻辑，下一个人就看不清「应用起来到底做了哪几件事」。
 */

const DEVICES_FILE = "remote-devices.json"

export interface RemoteStatus {
  enabled: boolean
  /** 真的听起来了吗。配置开着但端口被占时，这两个值会不一样——**别把意图当成事实**。 */
  listening: boolean
  port: number
  devices: readonly Omit<Device, "hash">[]
  /** 现在挂着的配对码；没有就是 undefined。`kind` 是用它配上来的设备算哪一种。 */
  pairing: { code: string; expiresAt: number; kind: DeviceKind } | undefined
  /** 起不来时的原因，给人看。 */
  error: string | undefined
}

export interface RemoteInstallDeps {
  settings: () => Settings
  ledger: Ledger
  sinks: Sinks
  dispatch: (command: Command) => void
  /** 全量。`kind` 决定预算（电脑比手机宽，见 `scope.ts`）。 */
  replay: (sink: Sink, kind: DeviceKind) => Promise<void>
  /** 某条会话现在是哪一档。见 `remote/policy.ts` 的 `RUNS_IN_THREAD`。 */
  trustOf: (threadId: string) => Trust | undefined
  /** 一条会话的历史。分级 replay 的另一半，预算同样按 `kind`。 */
  history: (threadId: string, kind: DeviceKind) => Promise<{ events: readonly Event[]; trimmed: boolean }>
  /** 按名字找宿主通道（`main/channels.ts`）。「电脑」设备调通道时用；能不能调由 `exposure.ts` 判。 */
  channel: (name: string) => Handler | undefined
  log: Logger
}

export interface RemoteInstall {
  /**
   * 「有人在等你」往手机上送的那条路。
   *
   * **在 `attachHost` 之前拿不到**（它要设备表），所以 `index.ts` 用一个
   * 后绑的引用把它接给 `attention`。少了这一步，推送就只是一个没人调的函数。
   */
  relay: Relay
  status: () => RemoteStatus
  /** 设置改了之后调一次：该起的起、该停的停。 */
  sync: () => Promise<void>
  close: () => Promise<void>
}

function devicesPath(): string {
  return join(app.getPath("userData"), DEVICES_FILE)
}

function loadDevices(): readonly Device[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(devicesPath(), "utf8"))
    if (!Array.isArray(raw)) return []
    return raw.filter(isDevice)
  } catch {
    // 没有这个文件是常态（从没配过对）
    return []
  }
}

const KINDS: readonly unknown[] = ["phone", "desk"]
const TRUSTS: readonly unknown[] = ["read-only", "auto-edit", "full"]

/**
 * 盘上那一条像不像一台设备。**两个可选字段也要核**：`kind` 写坏了（手改过文件）
 * 不能被读成 `desk`——那等于凭空多给一整个面；上限写坏了同理。认不出就整条不认，
 * 那台设备重新配一次，比带着一个说不清的权限活着强。
 */
function isDevice(value: unknown): value is Device {
  if (typeof value !== "object" || value === null) return false
  const it = value as Record<string, unknown>
  return (
    typeof it["id"] === "string" &&
    typeof it["name"] === "string" &&
    typeof it["hash"] === "string" &&
    typeof it["createdAt"] === "number" &&
    typeof it["lastSeenAt"] === "number" &&
    (it["kind"] === undefined || KINDS.includes(it["kind"])) &&
    (it["maxTrust"] === undefined || TRUSTS.includes(it["maxTrust"]))
  )
}

function saveDevices(devices: readonly Device[], log: Logger): void {
  try {
    mkdirSync(dirname(devicesPath()), { recursive: true })
    writeFileSync(devicesPath(), `${JSON.stringify(devices, null, 2)}\n`, "utf8")
  } catch (error) {
    // **这条要吼**：写不进去意味着这次配的设备重启之后就没了，
    // 而用户会以为配好了——下次在外面连不上，且完全不知道为什么
    log.write("error", "remote", `设备表写不进磁盘：${String(error)}`)
  }
}

/**
 * 浏览器端的构建产物在哪。
 *
 * 打包时在 `<Contents>/Resources/web`（`extraResources`，见 electron-builder.yml）；
 * 开发时在 `apps/web/dist`。
 *
 * **两个都找不到就返回第一个候选**——服务端照常起，只是页面 404。
 * 那比「因为没构建前端所以整个远程功能不存在」好排查：至少 API 通得了，
 * `/api/me` 能回答「令牌还认不认」，问题范围一眼就缩到「前端没构建」。
 */
export function webRoot(): string {
  const candidates = [join(process.resourcesPath, "web"), join(app.getAppPath(), "..", "web", "dist")]
  return candidates.find((path) => existsSync(join(path, "index.html"))) ?? candidates[0] ?? ""
}

/**
 * 桌面渲染层的构建产物在哪（远程模式从 `/desk/` 送出去的那份）。
 *
 * 打包时在 `<Contents>/Resources/desk`（`extraResources`）；开发时是 `out/renderer`。
 * **窗口也从这里加载**——electron-builder 会把 extraResources 的来源从 asar 里剔掉，
 * 打包后 asar 里根本没有 `out/renderer`。所以 `/desk/` 送出去的永远是这台正在跑的那份构建。`pnpm dev` 下渲染层走 vite 开发服务器，`out/renderer`
 * 可能是旧的或者没有：远程模式要先 `electron-vite build` 一次。
 */
export function deskRoot(): string {
  const candidates = [join(process.resourcesPath, "desk"), join(import.meta.dirname, "..", "renderer")]
  return candidates.find((path) => existsSync(join(path, "index.html"))) ?? candidates[0] ?? ""
}

export function installRemote(deps: RemoteInstallDeps): RemoteInstall {
  const tokens = createTokenStore({
    load: loadDevices,
    save: (devices) => {
      saveDevices(devices, deps.log)
    },
    now: () => Date.now(),
  })
  const state: { server: RemoteServer | undefined; error: string | undefined } = {
    server: undefined,
    error: undefined,
  }
  const relay = createRelay({ tokens, sinks: deps.sinks, log: deps.log, vapid: loadVapid(deps.log) })

  const status = (): RemoteStatus => {
    const remote = deps.settings().remote
    return {
      enabled: remote.enabled,
      listening: state.server !== undefined,
      port: state.server?.port() ?? remote.port,
      devices: tokens.list().map(({ hash: _hash, ...rest }) => rest),
      pairing: tokens.pending(),
      error: state.error,
    }
  }

  const sync = async (): Promise<void> => {
    await syncOnce(deps, tokens, state, relay)
  }
  /**
   * 吊销一台设备：先删记录，**再把它现在连着的那些连接掐掉**。
   *
   * 顺序无所谓（两步都做完才算数），但**第二步不能省**：
   * 只删记录的话，那台已经握手完成的设备照旧收全部事件、照旧能发命令——
   * 而按下这颗按钮的场景恰恰是「手机丢了，它多半正连着」。
   */
  const revoke = (id: string): void => {
    const had = tokens.revoke(id)
    const cut = state.server?.disconnect(id) ?? 0
    if (had) deps.log.write("info", "remote", `吊销设备 ${id}，顺带掐掉 ${String(cut)} 条正连着的连接`)
  }

  installChannels({
    status,
    sync,
    revoke,
    pair: (kind) => {
      tokens.startPairing(kind)
    },
    setTrust: (id, trust) => {
      if (tokens.setTrust(id, trust)) deps.log.write("info", "remote", `设备 ${id} 的上限改成 ${trust ?? "跟随默认"}`)
    },
  })
  return { relay, status, sync, close: () => stop(state, deps.log) }
}


/** 按当前设置起停服务端。**不在 `installRemote` 里内联**：那个函数已经贴着行数闸门。 */
async function syncOnce(
  deps: RemoteInstallDeps,
  tokens: ReturnType<typeof createTokenStore>,
  state: { server: RemoteServer | undefined; error: string | undefined },
  relay: Relay,
): Promise<void> {
  const remote = deps.settings().remote
    // **形状校验放在最前，不管服务端在不在跑。**
    //
    // 「隧道那头的域名」这一栏只在开关打开之后才出现，所以用户的实际顺序
    // 必然是「先开 → 再填」——校验排在「已经在跑就早退」后面的话，
    // 它**永远跑不到用户真正走的那条路**。而 `checkRequest` 读的是实时配置，
    // 坏值当场生效：粘一个 `https://…` 进去，解析出的 hostname 是 `"https"`，
    // 手机上全部 403，而面板上写着「在听 127.0.0.1:17800」，一个红字都没有。
    state.error = undefined
    try {
      for (const entry of remote.trustedHosts) assertTrustedAuthority(entry)
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error)
      deps.log.write("error", "remote", `trustedHosts 配置有问题：${state.error}`)
      return
    }
    if (!remote.enabled) {
      await stop(state, deps.log)
      return
    }
    if (state.server !== undefined) return
    try {
      state.server = await startRemote({
        config: () => deps.settings().remote,
        language: () => deps.settings().language,
        webRoot: webRoot(),
        deskRoot: deskRoot(),
        pushKey: relay.key,
        tokens,
        ledger: deps.ledger,
        sinks: deps.sinks,
        dispatch: deps.dispatch,
        replay: deps.replay,
        trustOf: deps.trustOf,
        history: deps.history,
        channel: deps.channel,
        log: (level, message) => {
          deps.log.write(level, "remote", message)
        },
      })
    } catch (error) {
      // **起不来要说出来。** 端口被占、trustedHosts 写错——这些都是配置问题，
      // 而一个「开着却没在听」的开关是最难查的一类故障
      state.error = error instanceof Error ? error.message : String(error)
      deps.log.write("error", "remote", `远程服务端起不来：${state.error}`)
    }
}

async function stop(state: { server: RemoteServer | undefined }, log: Logger): Promise<void> {
  if (state.server === undefined) return
  const server = state.server
  state.server = undefined
  await server.close().catch((error: unknown) => {
    log.write("warn", "remote", `关闭远程服务端时出错：${String(error)}`)
  })
}

interface Channels {
  status: () => RemoteStatus
  sync: () => Promise<void>
  revoke: (id: string) => void
  pair: (kind: DeviceKind) => void
  setTrust: (id: string, trust: Trust | undefined) => void
}

/** 设置面板要用的五条窄通道。**每一条都回一份完整状态**，理由见 preload。 */
function installChannels(ch: Channels): void {
  ipcMain.handle("switchback:remote/status", () => ch.status())
  ipcMain.handle("switchback:remote/sync", async () => {
    await ch.sync()
    return ch.status()
  })
  // 种类认不出就按手机配：多给一个面的方向不能是默认
  ipcMain.handle("switchback:remote/pair", (_e, kind: unknown) => {
    ch.pair(kind === "desk" ? "desk" : "phone")
    return ch.status()
  })
  ipcMain.handle("switchback:remote/deviceTrust", (_e, req: unknown) => {
    const { id, trust } = (typeof req === "object" && req !== null ? req : {}) as { id?: unknown; trust?: unknown }
    if (typeof id === "string" && (trust === undefined || TRUSTS.includes(trust))) ch.setTrust(id, trust as Trust | undefined)
    return ch.status()
  })
  ipcMain.handle("switchback:remote/revoke", (_e, id: unknown) => {
    if (typeof id === "string") ch.revoke(id)
    return ch.status()
  })
}
