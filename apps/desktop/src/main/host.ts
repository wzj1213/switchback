import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"
import { app, clipboard, dialog, ipcMain, type BrowserWindow } from "electron"
import type { Command, Event, ThreadId } from "@omni/protocol"
import { createClaudeDriver, createCodexDriver } from "@omni/engine"
import { createHost, type Host } from "@omni/host"
import { createJournal, createRuleStore } from "@omni/journal"
import { createWorksite, type Worksite } from "@omni/worksite"
import { devEngine, devResume, devTrust } from "./devtools.js"
import { createBatcher } from "./batch.js"

export interface Attached {
  host: Host
  /** 回放磁盘上的历史用得到 */
  journal: ReturnType<typeof createJournal>
  /** 把一批事件直接推给窗口，不经过宿主——回放用 */
  push: (event: Event) => void
  /** 立刻发出攒着的事件。回放结束时要调一次，否则最后一批要等窗口到期。 */
  flush: () => void
  /** 最近建好的会话 id。`dispatch` 不回传 id，所以在事件流上截。 */
  lastThreadId: () => ThreadId | undefined
  /**
   * 把一次失败翻成界面看得见的东西。
   *
   * **每一条通往 `dispatch` 的路都必须经过它。** 之前只有 IPC 那条有 catch，
   * 开机自动建会话那条是裸的 `void promise`——引擎起不来时它变成一条未处理拒绝，
   * 界面就永远停在「正在打开工作区…」，没有报错、没有超时、什么都没有。
   */
  report: (error: unknown, threadId?: ThreadId) => void
}

/**
 * 把 `@omni/host` 接到窗口上。
 *
 * 事件只往**当前活着的窗口**广播；窗口没了就丢弃——渲染层重开时会重新拉状态
 * （持久化接上之前，重开等于新会话）。
 */
export function attachHost(windows: () => readonly BrowserWindow[]): Attached {
  const seen = { thread: undefined as ThreadId | undefined }

  // 合帧再过 IPC：codex 的命令输出是一行一条通知，逐条发会把渲染层压垮
  const batcher = createBatcher((events) => {
    for (const win of windows()) {
      if (!win.isDestroyed()) win.webContents.send("omni:events", events)
    }
  })

  const emit = (event: Event): void => {
    if (event.type === "thread.started") seen.thread = event.thread.id
    batcher.push(event)
  }

  // userData 而不是自己拼 ~/.omni：这是系统给应用的位置，
  // 用户换机器迁移、清理应用数据时才找得到、才带得走
  const journal = createJournal({ dir: join(app.getPath("userData"), "threads") })
  // 规则和事件分开存：删会话不该把「始终允许」一起删了
  const rules = createRuleStore(join(app.getPath("userData"), "rules"))

  const host = createHost({
    drivers: { claude: createClaudeDriver(), codex: createCodexDriver() },
    home: homedir(),
    journal,
    rules,
    emit,
    newId: (prefix) => `${prefix}-${randomUUID()}`,
    now: () => Date.now(),
  })

  // 目录选择必须在主进程弹：渲染层没有、也不该有触碰文件系统的能力。
  // 回给渲染层的只是一个用户亲手选中的路径。
  ipcMain.handle("omni:pickFolder", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "选择工作区",
    })
    return result.canceled ? undefined : result.filePaths[0]
  })

  const report = (error: unknown, threadId?: ThreadId): void => {
    emit({
      type: "engine.status",
      at: Date.now(),
      threadId: threadId ?? "",
      status: "crashed",
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  // 剪贴板走主进程：渲染层加载的是 file://，那里的 navigator.clipboard
  // 不算安全上下文，写入会被静默拒绝
  ipcMain.on("omni:copy", (_e, text: string) => {
    clipboard.writeText(text)
  })

  // 一个工作区一份索引，按 cwd 复用：同一目录开好几个会话不该各扫一遍
  const worksites = new Map<string, Worksite>()
  ipcMain.handle("omni:searchFiles", async (_e, req: { cwd: string; query: string }) => {
    const site = worksites.get(req.cwd) ?? createWorksite(req.cwd)
    worksites.set(req.cwd, site)
    return (await site.search(req.query)).map((h) => h.path)
  })

  ipcMain.on("omni:command", (_e, command: Command) => {
    // 命令失败不能掐掉主进程：翻成一条状态事件送回界面
    void host.dispatch(command).catch((error: unknown) => {
      report(error, "threadId" in command ? command.threadId : undefined)
    })
  })

  // 回放要一次灌进去几百上千条，攒着没有意义，直接推
  return { host, journal, push: emit, flush: () => { batcher.flush() }, lastThreadId: () => seen.thread, report }
}

/**
 * 回放磁盘上的历史。
 *
 * **不经过宿主。** 宿主管的是活着的会话；磁盘上的是历史，背后没有引擎进程。
 * 回放出来的会话最后补一条 `detached: true`，界面据此把输入框关掉——
 * 一个能打字却答非所问的输入框比没有输入框糟得多。
 */
export async function replayHistory(attached: Attached): Promise<ThreadId | undefined> {
  const ids = await attached.journal.list()
  for (const id of ids) {
    const events = await attached.journal.read(id)
    if (events.length === 0) continue
    for (const event of events) attached.push(event)
    const last = [...events].reverse().find((e) => e.type === "thread.started" || e.type === "thread.updated")
    if (last === undefined || (last.type !== "thread.started" && last.type !== "thread.updated")) continue
    attached.push({
      type: "thread.updated",
      at: Date.now(),
      thread: { ...last.thread, status: "idle", detached: true },
    })
  }
  attached.flush()
  return ids[0]
}

/**
 * 开一个默认会话，指向应用当前工作目录，让界面一进来就能用。
 * `prompt` 只在开发钩子（`OMNI_DEV_PROMPT`）下传入，正常启动不会自动发消息。
 */
export async function seedDefaultThread(
  attached: Attached,
  cwd: string,
  prompt?: string,
  resumeId?: ThreadId,
): Promise<void> {
  try {
    if (resumeId !== undefined && devResume()) await resumeInto(attached, resumeId, prompt)
    else await seed(attached, cwd, prompt)
  } catch (error) {
    // 引擎起不来是最常见的开箱故障（没装、没登录、版本不对），
    // 它必须变成界面上的一条横幅，而不是一条没人看的未处理拒绝
    attached.report(error)
  }
}

/** 开发钩子：续跑磁盘上最近那个会话，再往里发一句话。 */
async function resumeInto(attached: Attached, threadId: ThreadId, prompt?: string): Promise<void> {
  await attached.host.dispatch({ type: "thread.resume", threadId })
  if (prompt !== undefined) await attached.host.dispatch({ type: "thread.prompt", threadId, text: prompt })
}

async function seed(attached: Attached, cwd: string, prompt?: string): Promise<void> {
  await attached.host.dispatch({
    type: "thread.create",
    cwd,
    engine: devEngine(),
    trust: devTrust(),
    title: cwd.split("/").pop() ?? "工作区",
  })
  const threadId = attached.lastThreadId()
  if (prompt === undefined || threadId === undefined) return
  await attached.host.dispatch({ type: "thread.prompt", threadId, text: prompt })
}
