import type { IpcMain } from "electron"

/**
 * 渲染层 → 主进程的窄通道，**登记在一张表上**。
 *
 * ## 为什么要一张表
 *
 * 远程模式（`docs/远程模式方案.md`）里，另一台电脑上的桌面界面要调同样的通道。
 * 宿主那侧调的必须是**同一个处理函数**——为远程另写一份，两份迟早不一样，
 * 而不一样的那份正好是远程那头在用的。
 *
 * 所以 `handle(name, fn)` 同时做两件事：挂到 `ipcMain`（本机窗口照旧），
 * 并把 `fn` 记在表上（远程按名字找它）。
 *
 * ## 记在表上不等于远程能调
 *
 * 能不能调由 `remote/exposure.ts` 那张白名单说了算，表外一律拒。两道是有意叠的：
 * 只在本机有意义的通道（弹框、访达、系统编辑器、装引擎）**照旧直接挂 `ipcMain`、不进这张表**，
 * 于是就算有人手滑把它们写进白名单，远程也找不到处理函数——拒得掉。
 *
 * ## 处理函数只拿参数，不拿 `event`
 *
 * 远程调用没有 `event.sender`。要用 sender 的通道（认窗口、往发起方推东西）
 * 本来就不该能被远程调，它们也就不走这里。
 */
export type Handler = (arg: unknown) => unknown

export interface Channels {
  /** 一条有回话的通道（`ipcRenderer.invoke`）。 */
  handle: (name: string, fn: Handler) => void
  /** 一条不回话的通道（`ipcRenderer.send`）。远程调它时回话的值是 undefined。 */
  on: (name: string, fn: (arg: unknown) => void) => void
  /** 按名字找处理函数。没登记过的返回 undefined。 */
  find: (name: string) => Handler | undefined
}

export function createChannels(ipc: Pick<IpcMain, "handle" | "on">): Channels {
  const table = new Map<string, Handler>()
  // **同名挂两次是 bug，当场炸。** `ipcMain.handle` 自己也会抛，但 `on` 不会——
  // 它会安静地多挂一个监听，于是一次 send 跑两遍处理函数（存两份草稿、删两次图）
  const remember = (name: string, fn: Handler): void => {
    if (table.has(name)) throw new Error(`通道 ${name} 挂了两次`)
    table.set(name, fn)
  }
  return {
    handle: (name, fn) => {
      remember(name, fn)
      ipc.handle(name, (_event, arg: unknown) => fn(arg))
    },
    on: (name, fn) => {
      remember(name, fn)
      ipc.on(name, (_event, arg: unknown) => {
        fn(arg)
      })
    },
    find: (name) => table.get(name),
  }
}
