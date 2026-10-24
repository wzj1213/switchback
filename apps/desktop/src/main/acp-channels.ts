import { homedir } from "node:os"
import { join } from "node:path"
import { app, ipcMain, shell, type WebContents } from "electron"
import { probeCommand, tryAcp } from "@switchback/engine"
import type { Locale } from "@switchback/i18n"
import type { ConnectProgress, RegistryRow, RegistryView } from "../shared/acp-registry.js"
import { connectAgent } from "./acp-connect.js"
import { engineRows, loginEngine, logoutEngine, pruneUnused, removeEngine, tryEngine, type EngineOpsDeps } from "./acp-engines.js"
import { installBinary } from "./acp-install.js"
import { createAcpRegistry, type RegistrySnapshot } from "./acp-registry.js"
import { planOf, platformOf, type RegistryAgent } from "./acp-registry-model.js"
import { compare, runCommand } from "./enginever-command.js"
import { readEngineFile, type EngineFile } from "./engines.js"
import type { Attached } from "./host.js"
import type { Logger } from "./log.js"
import { openTerminalLogin } from "./terminal-login.js"

/**
 * 「安装与接入」页上 ACP 那几块的通道：注册表、接入、已接的几家与它们的登录。
 *
 * 这里只做接线：每件事的规矩写在各自的模块里（`acp-connect` / `acp-engines` / `acp-install`）。
 * 渲染层递过来的只有**名字**（注册表 id、engines.json 的键、登录方式 id）——
 * 要执行的命令一律由主进程从注册表或 engines.json 里现取。
 */

/** 下载进度最多这么密地往界面推一次：一个 100 MB 的包按块算能有上千条。 */
const PROGRESS_MS = 150

async function has(command: string): Promise<boolean> {
  return (await probeCommand(command, "")).state === "ok"
}

async function launchers(): Promise<{ npx: boolean; uvx: boolean }> {
  const [npx, uvx] = await Promise.all([has("npx"), has("uvx")])
  return { npx, uvx }
}

function connectedOf(agent: RegistryAgent, file: EngineFile): RegistryRow["connected"] {
  const found = Object.entries(file).find(([, entry]) => entry.registry?.id === agent.id)
  if (found === undefined || found[1].registry === undefined) return undefined
  const version = found[1].registry.version
  return { name: found[0], version, update: compare(agent.version, version) > 0 }
}

/** 界面要的那几个字段。分发细节不往外送——要执行什么由 `plan` 说，而它是按这台机器算过的。 */
function infoOf(agent: RegistryAgent): Omit<RegistryRow, "plan" | "missing" | "connected"> {
  const { id, name, version, authors, description, repository, website, license } = agent
  return {
    id, name, version, authors,
    ...(description === undefined ? {} : { description }),
    ...(repository === undefined ? {} : { repository }),
    ...(website === undefined ? {} : { website }),
    ...(license === undefined ? {} : { license }),
  }
}

function rowOf(agent: RegistryAgent, found: { npx: boolean; uvx: boolean }, file: EngineFile, locale: Locale): RegistryRow {
  const plan = planOf(agent, platformOf(process.platform, process.arch), found, locale)
  const connected = connectedOf(agent, file)
  return { ...infoOf(agent), ...plan, ...(connected === undefined ? {} : { connected }) }
}

async function viewOf(snapshot: RegistrySnapshot, at: { userData: string; log: Logger; locale: Locale }): Promise<RegistryView> {
  const found = await launchers()
  const file = readEngineFile(at.userData, at.log)
  return {
    rows: snapshot.agents.map((agent) => rowOf(agent, found, file, at.locale)),
    source: snapshot.source,
    ...(snapshot.fetchedAt === undefined ? {} : { fetchedAt: snapshot.fetchedAt }),
    ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
  }
}

/** 进度推送：同一阶段内按时间节流，换阶段立刻推。 */
function progressTo(sender: WebContents): (step: ConnectProgress) => void {
  const last = { at: 0, phase: "" }
  return (step) => {
    const now = Date.now()
    if (step.phase === last.phase && now - last.at < PROGRESS_MS) return
    last.at = now
    last.phase = step.phase
    if (!sender.isDestroyed()) sender.send("switchback:acpProgress", step)
  }
}

export function installAcpChannels(attached: Attached, log: Logger, locale: () => Locale): void {
  const userData = app.getPath("userData")
  const registry = createAcpRegistry({ dir: userData, fetch, now: () => Date.now(), log, locale })
  const inUse = (id: string): boolean => attached.host.live().some((thread) => thread.engine === id)
  const refresh = (): Promise<unknown> => attached.refreshEngines()
  const ops: EngineOpsDeps = {
    userData, log, home: homedir(), inUse, refresh, locale,
    openTerminal: (login) => openTerminalLogin(join(userData, "login"), login, (path) => shell.openPath(path), locale()),
  }
  const pending = new Map<string, AbortController>()
  const abortable = (key: string): AbortSignal => {
    pending.get(key)?.abort()
    const controller = new AbortController()
    pending.set(key, controller)
    return controller.signal
  }

  ipcMain.handle("switchback:acpRegistry", async (_event, force?: boolean) =>
    viewOf(await registry.read(force === true), { userData, log, locale: locale() }))
  ipcMain.handle("switchback:acpConnect", async (event, agentId: string) => {
    const signal = abortable(`connect:${agentId}`)
    const progress = progressTo(event.sender)
    const language = locale()
    return connectAgent(agentId, {
      userData, log, home: homedir(), platform: platformOf(process.platform, process.arch),
      registry: () => registry.read(), launchers, refresh, inUse, progress, locale: language,
      // 同一个信号：下载时点「取消」停下载，试接时点停握手（npx 第一次下载能等三分钟）
      trial: (req) => tryAcp({ ...req, signal, locale: language }),
      install: (agent, plan) => installBinary(agent, plan, {
        root: join(userData, "agents"), fetch, run: runCommand, platform: process.platform, signal, locale: language,
        onProgress: (phase, received, total) => progress({ agentId, phase, ...(received === undefined ? {} : { received }), ...(total === undefined ? {} : { total }) }),
      }),
    })
  })
  ipcMain.handle("switchback:acpEngines", () => engineRows(ops))
  ipcMain.handle("switchback:acpEngineTry", (_event, name: string) => tryEngine(name, ops))
  ipcMain.handle("switchback:acpLogin", (_event, req: { name: string; methodId: string; kind: "agent" | "terminal" }) =>
    loginEngine(req, ops, abortable(`login:${req.name}`)))
  ipcMain.handle("switchback:acpLogout", (_event, name: string) => logoutEngine(name, ops))
  ipcMain.handle("switchback:acpEngineRemove", (_event, name: string) => removeEngine(name, ops))
  ipcMain.handle("switchback:acpCancel", (_event, key: string) => {
    pending.get(key)?.abort()
  })
  // 启动时清一次没人用的旧版本：此刻还没有任何会话起过，删不到在用的
  void pruneUnused(userData).then((removed) => {
    if (removed.length > 0) log.write("info", "engines", `清掉了 ${String(removed.length)} 个没人用的引擎旧版本`)
  })
}
