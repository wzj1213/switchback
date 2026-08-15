/**
 * JSON-RPC 2.0 over 换行分隔的 JSON。
 *
 * **两家共用**：codex app-server 与 ACP 的 stdio 传输是同一个东西——
 * 一行一条 JSON，`jsonrpc: "2.0"`。接 ACP 时本文件从 `codex/` 提到包根，
 * 一个字没改就跑通了；抄一份的话，两边的分帧 bug 就得各修一次。
 *
 * 有意做成**纯粹的字节进、字节出**：`feed(chunk)` 喂进来，`send(line)` 发出去。
 * 不碰子进程，所以没装任何引擎的机器上也能跑测试。
 */

/** JSON-RPC 允许 id 是字符串或数字。**数字包括 0**——见 `dispatch` 里的判据。 */
export type RequestId = string | number

/** 服务端发来的请求。必须应答——不答 codex 会一直等着，整轮卡死。 */
export interface ServerCall {
  method: string
  params: unknown
  /** 幂等：重复调用只有第一次生效。 */
  respond: (result: unknown) => void
}

export interface RpcHandlers {
  /** 出站的一行（不含换行符，由本模块补） */
  send: (line: string) => void
  onNotification: (method: string, params: unknown) => void
  onRequest: (call: ServerCall) => void
  /** 解析不了的行。不抛——对端多打一行日志不该掀翻会话。 */
  onGarbage?: (line: string) => void
}

export interface RpcPeer {
  call: (method: string, params?: unknown) => Promise<unknown>
  notify: (method: string, params?: unknown) => void
  feed: (chunk: string) => void
  /**
   * 落定所有在途请求（一律 reject）。
   *
   * 这条**必须**在关闭路径上调用。一个永远不 resolve 的 `call()` 会把
   * `dispose()` 顶死在 await 上——和审批门 `settleAll()` 是同一个教训。
   */
  close: (reason: string) => void
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

interface Incoming {
  id?: RequestId
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string }
}

function parse(line: string): Incoming | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === "object" && value !== null ? (value as Incoming) : undefined
  } catch {
    return undefined
  }
}

type Write = (payload: Record<string, unknown>) => void

interface RpcState {
  seq: number
  buffer: string
  closed: boolean
  pending: Map<RequestId, Pending>
}

function settleReply(state: RpcState, msg: Incoming): void {
  const id = msg.id
  if (id === undefined) return
  const waiter = state.pending.get(id)
  if (waiter === undefined) return
  state.pending.delete(id)
  if (msg.error === undefined) waiter.resolve(msg.result)
  else waiter.reject(new Error(msg.error.message ?? "对端返回了错误"))
}

/** `respond` 幂等：重复应答同一个 id 会让对端认不出，只认第一次。 */
function toServerCall(write: Write, id: RequestId, method: string, params: unknown): ServerCall {
  const answered = { done: false }
  return {
    method,
    params,
    respond: (result: unknown): void => {
      if (answered.done) return
      answered.done = true
      write({ id, result })
    },
  }
}

function dispatch(state: RpcState, handlers: RpcHandlers, write: Write, line: string): void {
  const msg = parse(line)
  if (msg === undefined) {
    handlers.onGarbage?.(line)
    return
  }
  // 三分支的判据就是 JSON-RPC 的定义：有 id 无 method 是应答，
  // 有 id 有 method 是服务端请求，无 id 是通知。
  //
  // 判据写成 `!== undefined` 而不是真值判断：实测 codex-acp 的
  // `session/request_permission` 用的就是 **id 0**，写成 `if (msg.id)` 会把
  // 这条请求当成通知，于是永远不应答，整轮卡死在等审批上。
  if (msg.id !== undefined && msg.method === undefined) settleReply(state, msg)
  else if (msg.id !== undefined && msg.method !== undefined) {
    handlers.onRequest(toServerCall(write, msg.id, msg.method, msg.params))
  } else if (msg.method !== undefined) handlers.onNotification(msg.method, msg.params)
}

export function createRpc(handlers: RpcHandlers): RpcPeer {
  const state: RpcState = { seq: 0, buffer: "", closed: false, pending: new Map() }
  const write: Write = (payload) => {
    handlers.send(JSON.stringify({ jsonrpc: "2.0", ...payload }))
  }

  return {
    call: (method, params) => {
      if (state.closed) return Promise.reject(new Error(`连接已关闭，${method} 未发出`))
      state.seq += 1
      const id = state.seq
      return new Promise<unknown>((resolve, reject) => {
        state.pending.set(id, { resolve, reject })
        write({ id, method, ...(params === undefined ? {} : { params }) })
      })
    },
    notify: (method, params) => {
      if (!state.closed) write({ method, ...(params === undefined ? {} : { params }) })
    },
    feed: (chunk) => {
      // 一次 stdout 事件不保证是整行，可能半行、也可能好几行。
      // 最后一段留在 buffer 里等下一次——这是最常见的 stdio 协议 bug。
      const parts = (state.buffer + chunk).split("\n")
      state.buffer = parts.pop() ?? ""
      for (const part of parts) {
        if (part.trim() !== "") dispatch(state, handlers, write, part)
      }
    },
    close: (reason) => {
      if (state.closed) return
      state.closed = true
      for (const waiter of state.pending.values()) waiter.reject(new Error(reason))
      state.pending.clear()
    },
  }
}
