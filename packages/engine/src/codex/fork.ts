import type { RpcPeer } from "../rpc.js"

interface ForkRequest {
  handle: string
  dropTurns?: number
}

interface WireTurn {
  id?: unknown
}

interface WireTurnPage {
  data?: unknown
  nextCursor?: unknown
}

function turnId(turns: readonly WireTurn[], index: number): string {
  const id = turns[index]?.id
  if (typeof id !== "string" || id === "") throw new Error("Codex 没有返回历史边界的 turn id")
  return id
}

async function boundary(
  call: RpcPeer["call"],
  threadId: string,
  count: number,
): Promise<{ lastTurnId: string } | { beforeTurnId: string }> {
  if (!Number.isInteger(count) || count < 1) throw new Error(`无效的 Codex 历史移除轮数：${String(count)}`)
  const raw = await call("thread/turns/list", {
    threadId,
    limit: count + 1,
    sortDirection: "desc",
    itemsView: "notLoaded",
  }) as WireTurnPage
  const turns: readonly WireTurn[] = Array.isArray(raw.data) ? raw.data : []
  if (turns.length < count) {
    throw new Error(`Codex 源会话只有 ${String(turns.length)} 轮，无法从末尾移除 ${String(count)} 轮`)
  }
  if (turns.length > count) return { lastTurnId: turnId(turns, count) }
  if (raw.nextCursor !== null) throw new Error("Codex 没有返回待保留轮次的分页边界")
  return { beforeTurnId: turnId(turns, turns.length - 1) }
}

function forkId(raw: unknown): string {
  const id = (raw as { thread?: { id?: unknown } } | undefined)?.thread?.id
  if (typeof id !== "string" || id === "") throw new Error("Codex 没有返回分叉出来的会话 id")
  return id
}

/** 在原生 fork 请求上直接带历史边界；不会先复制完整历史再做一次有兼容差异的裁剪。 */
export async function forkCodexThread(call: RpcPeer["call"], request: ForkRequest): Promise<unknown> {
  const count = request.dropTurns ?? 0
  const edge = count === 0 ? {} : await boundary(call, request.handle, count)
  const forked = await call("thread/fork", { threadId: request.handle, ...edge })
  forkId(forked)
  return forked
}
