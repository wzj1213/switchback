import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { app, ipcMain } from "electron"
import type { Command } from "@omni/protocol"
import type { Ledger } from "@omni/wire"
import type { Sink, Sinks } from "../sink.js"
import type { Logger } from "./../log.js"
import type { Settings } from "../../shared/settings.js"
import { assertTrustedAuthority } from "./fence.js"
import { createTokenStore, type Device, type TokenStore } from "./tokens.js"
import { startRemote, type RemoteServer } from "./server.js"

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
  /** 现在挂着的配对码；没有就是 undefined。 */
  pairing: { code: string; expiresAt: number } | undefined
  /** 起不来时的原因，给人看。 */
  error: string | undefined
}

export interface RemoteInstallDeps {
  settings: () => Settings
  ledger: Ledger
  sinks: Sinks
  dispatch: (command: Command) => void
  replay: (sink: Sink) => Promise<void>
  log: Logger
}

export interface RemoteInstall {
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

function isDevice(value: unknown): value is Device {
  if (typeof value !== "object" || value === null) return false
  const it = value as Record<string, unknown>
  return (
    typeof it["id"] === "string" &&
    typeof it["name"] === "string" &&
    typeof it["hash"] === "string" &&
    typeof it["createdAt"] === "number" &&
    typeof it["lastSeenAt"] === "number"
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
    const remote = deps.settings().remote
    if (!remote.enabled) {
      await stop(state, deps.log)
      return
    }
    if (state.server !== undefined) return
    state.error = undefined
    try {
      for (const entry of remote.trustedHosts) assertTrustedAuthority(entry)
      state.server = await startRemote({
        config: () => deps.settings().remote,
        webRoot: webRoot(),
        tokens,
        ledger: deps.ledger,
        sinks: deps.sinks,
        dispatch: deps.dispatch,
        replay: deps.replay,
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

  installChannels(tokens, status, sync)
  return { status, sync, close: () => stop(state, deps.log) }
}

async function stop(state: { server: RemoteServer | undefined }, log: Logger): Promise<void> {
  if (state.server === undefined) return
  const server = state.server
  state.server = undefined
  await server.close().catch((error: unknown) => {
    log.write("warn", "remote", `关闭远程服务端时出错：${String(error)}`)
  })
}

/** 设置面板要用的四条窄通道。 */
function installChannels(tokens: TokenStore, status: () => RemoteStatus, sync: () => Promise<void>): void {
  ipcMain.handle("omni:remote/status", () => status())
  ipcMain.handle("omni:remote/sync", async () => {
    await sync()
    return status()
  })
  ipcMain.handle("omni:remote/pair", () => {
    tokens.startPairing()
    return status()
  })
  ipcMain.handle("omni:remote/revoke", (_e, id: unknown) => {
    if (typeof id === "string") tokens.revoke(id)
    return status()
  })
}
