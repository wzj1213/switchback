import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { ipcMain, type BrowserWindow } from "electron"
import type { Command, Event, ThreadId } from "@omni/protocol"
import { createClaudeDriver, createCodexDriver } from "@omni/engine"
import { createHost, type Host } from "@omni/host"
import { devEngine } from "./devtools.js"

export interface Attached {
  host: Host
  /** 最近建好的会话 id。`dispatch` 不回传 id，所以在事件流上截。 */
  lastThreadId: () => ThreadId | undefined
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

  ipcMain.on("omni:command", (_e, command: Command) => {
    // 命令失败不能掐掉主进程：翻成一条状态事件送回界面
    void host.dispatch(command).catch((error: unknown) => {
      emit({
        type: "engine.status",
        at: Date.now(),
        threadId: "threadId" in command ? command.threadId : "",
        status: "crashed",
        detail: error instanceof Error ? error.message : String(error),
      })
    })
  })

  return { host, lastThreadId: () => seen.thread }
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
  await attached.host.dispatch({
    type: "thread.create",
    cwd,
    engine: devEngine(),
    trust: "auto-edit",
    title: cwd.split("/").pop() ?? "工作区",
  })
  const threadId = attached.lastThreadId()
  if (prompt === undefined || threadId === undefined) return
  await attached.host.dispatch({ type: "thread.prompt", threadId, text: prompt })
}
