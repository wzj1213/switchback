import type { RpcPeer } from "../rpc.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { CODEX_FORK } from "./fork.messages.js"

interface ForkRequest {
  handle: string
  dropTurns?: number
}

interface WireTurn {
  id?: unknown
}

interface WireThreadRead {
  thread?: { turns?: unknown }
}

type Text = (typeof CODEX_FORK)[Locale]

function turnId(turns: readonly WireTurn[], index: number, m: Text): string {
  const id = turns[index]?.id
  if (typeof id !== "string" || id === "") throw new Error(m.noTurnId)
  return id
}

async function boundary(
  call: RpcPeer["call"],
  threadId: string,
  count: number,
  m: Text,
): Promise<{ lastTurnId: string }> {
  if (!Number.isInteger(count) || count < 1) throw new Error(m.badCount(count))
  const raw = await call("thread/read", { threadId, includeTurns: true }) as WireThreadRead
  const turns: readonly WireTurn[] = Array.isArray(raw.thread?.turns) ? raw.thread.turns : []
  if (turns.length <= count) {
    if (turns.length === count) {
      throw new Error(m.beforeFirst)
    }
    throw new Error(m.tooFew(turns.length, count))
  }
  return { lastTurnId: turnId(turns, turns.length - count - 1, m) }
}

function forkId(raw: unknown, m: Text): string {
  const id = (raw as { thread?: { id?: unknown } } | undefined)?.thread?.id
  if (typeof id !== "string" || id === "") throw new Error(m.noForkId)
  return id
}

/** 在原生 fork 请求上直接带历史边界；不会先复制完整历史再做一次有兼容差异的裁剪。 */
export async function forkCodexThread(
  call: RpcPeer["call"],
  request: ForkRequest,
  locale: Locale = DEFAULT_LOCALE,
): Promise<unknown> {
  const m = CODEX_FORK[locale]
  const count = request.dropTurns ?? 0
  const edge = count === 0 ? {} : await boundary(call, request.handle, count, m)
  const forked = await call("thread/fork", { threadId: request.handle, ...edge })
  forkId(forked, m)
  return forked
}
