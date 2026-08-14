import { randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { ipcMain, type BrowserWindow } from "electron"
import type { Command, Event } from "@omni/protocol"
import { createClaudeDriver } from "@omni/engine"
import { createHost, type Host } from "@omni/host"

/**
 * 把 `@omni/host` 接到窗口上。
 *
 * 事件只往**当前活着的窗口**广播；窗口没了就丢弃——渲染层重开时会重新拉状态
 * （持久化接上之前，重开等于新会话）。
 */
export function attachHost(windows: () => readonly BrowserWindow[]): Host {
  const emit = (event: Event): void => {
    for (const win of windows()) {
      if (!win.isDestroyed()) win.webContents.send("omni:event", event)
    }
  }

  const host = createHost({
    drivers: { claude: createClaudeDriver() },
    home: homedir(),
    emit,
    newId: (prefix) => `${prefix}-${randomUUID()}`,
    now: () => Date.now(),
  })

  ipcMain.on("omni:command", (_e, command: Command) => {
    // 命令失败不能掐掉主进程：翻成一条错误 item 送回界面
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

  return host
}

/** 开一个默认会话，指向应用当前工作目录，让界面一进来就能用。 */
export async function seedDefaultThread(host: Host, cwd: string): Promise<void> {
  await host.dispatch({
    type: "thread.create",
    cwd,
    engine: "claude",
    trust: "auto-edit",
    title: cwd.split("/").pop() ?? "工作区",
  })
}
