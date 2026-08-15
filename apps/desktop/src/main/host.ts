import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { dialog, ipcMain, type BrowserWindow } from "electron"
import type { Command, Event, ThreadId } from "@omni/protocol"
import { createClaudeDriver, createCodexDriver } from "@omni/engine"
import { createHost, type Host } from "@omni/host"
import { devEngine, devTrust } from "./devtools.js"

export interface Attached {
  host: Host
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

  const emit = (event: Event): void => {
    if (event.type === "thread.started") seen.thread = event.thread.id
    for (const win of windows()) {
      if (!win.isDestroyed()) win.webContents.send("omni:event", event)
    }
  }

  const host = createHost({
    drivers: { claude: createClaudeDriver(), codex: createCodexDriver() },
    home: homedir(),
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

  ipcMain.on("omni:command", (_e, command: Command) => {
    // 命令失败不能掐掉主进程：翻成一条状态事件送回界面
    void host.dispatch(command).catch((error: unknown) => {
      report(error, "threadId" in command ? command.threadId : undefined)
    })
  })

  return { host, lastThreadId: () => seen.thread, report }
}

/**
 * 开一个默认会话，指向应用当前工作目录，让界面一进来就能用。
 * `prompt` 只在开发钩子（`OMNI_DEV_PROMPT`）下传入，正常启动不会自动发消息。
 */
export async function seedDefaultThread(
  attached: Attached,
  cwd: string,
  prompt?: string,
): Promise<void> {
  try {
    await seed(attached, cwd, prompt)
  } catch (error) {
    // 引擎起不来是最常见的开箱故障（没装、没登录、版本不对），
    // 它必须变成界面上的一条横幅，而不是一条没人看的未处理拒绝
    attached.report(error)
  }
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
