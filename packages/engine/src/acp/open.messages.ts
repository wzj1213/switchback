import { defineMessages } from "@switchback/i18n"

/** 开场失败时说的话：握手超时、协议版本太新、续不上、分不出来。stderr 尾巴由调用方原样接在后面。 */
export const ACP_OPEN = defineMessages(
  {
    handshake: (id: string, seconds: number) => `${id} 在 ${String(seconds)} 秒内没有完成握手，已放弃。`,
    tooNew: (id: string, version: number, supported: number) =>
      `${id} 讲的是 ACP v${String(version)}，Switchback 只认到 v${String(supported)}。请升级 Switchback。`,
    forkTail: (id: string) => `${id} 的 ACP 分叉不能停在历史轮次，已拒绝完整历史冒充回退。`,
    noResume: (id: string) => `${id} 不支持续跑（没有 loadSession 能力），这个会话没法接着上次跑。`,
    forkNeedsLoad: (id: string) => `${id} 的原生分叉需要 loadSession，但它没有声明这项能力。`,
    forkNoHandle: (id: string) => `${id} 的原生分叉没有返回新会话句柄。`,
    noSessionId: (id: string) => `${id} 没有返回 sessionId，无法继续`,
  },
  {
    handshake: (id, seconds) => `${id} didn't finish the handshake within ${String(seconds)} seconds, so Switchback gave up.`,
    tooNew: (id, version, supported) =>
      `${id} speaks ACP v${String(version)}, but Switchback only supports up to v${String(supported)}. Update Switchback.`,
    forkTail: (id) => `An ACP fork of ${id} can't stop at an earlier turn; Switchback refused to pass off the full history as a rewind.`,
    noResume: (id) => `${id} can't resume threads (it has no loadSession capability), so this thread can't pick up where it left off.`,
    forkNeedsLoad: (id) => `${id}'s native fork needs loadSession, but it doesn't declare that capability.`,
    forkNoHandle: (id) => `${id}'s native fork didn't return a new session handle.`,
    noSessionId: (id) => `${id} didn't return a sessionId, so the thread can't continue`,
  },
)
