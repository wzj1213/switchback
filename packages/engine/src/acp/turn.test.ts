import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { compactSession, reportCompaction, steerSession, type TurnCtx } from "./turn.js"

/**
 * `zcode.live.test.ts` 钉 compact 真能调用，`zcode-steer.live.test.ts` 则钉住当前后端
 * 虽有桥接路由却拒绝 steer。这里钉的是**没说支持的时候不发那一发 RPC**，以及拒绝时说的是人话——
 * 那两件事跟哪家引擎都无关，也不该为它起一个进程。
 */
// **不用默认参数装 `acpSession`**：显式传 `undefined` 会走默认值，
// 于是「会话还没建立」那条根本没测到它想测的分支（这个坑今天踩第二次了）。
// 包一层对象，`{ acpSession: undefined }` 就是真的 undefined
function ctx(can: TurnCtx["can"], session: TurnCtx["state"] = { acpSession: "s-1" }): TurnCtx & { sent: string[] } {
  const sent: string[] = []
  return {
    id: "acp:某家",
    call: (method) => {
      sent.push(method)
      return Promise.resolve({})
    },
    state: session,
    can,
    sent,
  }
}

describe("压缩上下文", () => {
  it("说了支持才发，发的是 `session/compact`", async () => {
    const c = ctx({ compact: true })
    await compactSession(c)
    expect(c.sent).toEqual(["session/compact"])
  })

  // 三家里两家没有这个方法。发过去只会拿回 `-32601`，而那句话对用户毫无意义
  it("**没说支持就一发都不发**，并且说清是这家做不到、不是坏了", async () => {
    const c = ctx({})
    await expect(compactSession(c)).rejects.toThrow(/不支持压缩上下文/)
    expect(c.sent).toEqual([])
  })

  it("会话还没建立时不发", async () => {
    const c = ctx({ compact: true }, { acpSession: undefined })
    await expect(compactSession(c)).rejects.toThrow(/会话还没建立/)
    expect(c.sent).toEqual([])
  })

  it("成功回包后把压缩结果落在宿主给的轮次并收工", () => {
    const events: Event[] = []
    reportCompaction((event) => events.push(event), "compact-turn", 9)
    expect(events).toEqual([
      {
        type: "item.started",
        at: 9,
        item: {
          id: "acp-compaction-compact-turn",
          turnId: "compact-turn",
          at: 9,
          kind: "notice",
          message: "上下文已压缩。",
          level: "info",
        },
      },
      { type: "turn.completed", at: 9, turnId: "compact-turn", status: "completed" },
    ])
  })
})

describe("中途插话", () => {
  // 字段名是读 zcode-acp-server 的源码抄的：发 `text` 会拿到 `-32603 Internal error`，
  // 那看起来像「方法坏了」，其实是参数名不对——同一个错误码兼着两种意思
  it("字段名是 `content`，不是 `text` 也不是 `prompt`", async () => {
    const seen: unknown[] = []
    const c: TurnCtx = {
      id: "acp:某家",
      call: (_m, params) => {
        seen.push(params)
        return Promise.resolve({})
      },
      state: { acpSession: "s-1" },
      can: { steer: true },
    }
    await steerSession(c, "先停一下")
    expect(seen[0]).toEqual({ sessionId: "s-1", content: "先停一下" })
  })

  it("厂商公开了自己的插话入口时，完整采用它的方法名与参数", async () => {
    const seen: { method: string; params: unknown }[] = []
    const c: TurnCtx = {
      id: "grok",
      call: (method, params) => {
        seen.push({ method, params })
        return Promise.resolve({})
      },
      state: { acpSession: "s-1" },
      can: { steerCall: (sessionId, text) => ({ method: "vendor/interject", params: { sessionId, text } }) },
    }
    await steerSession(c, "转向")
    expect(seen).toEqual([{ method: "vendor/interject", params: { sessionId: "s-1", text: "转向" } }])
  })

  it("没说支持就一发都不发", async () => {
    const c = ctx({})
    await expect(steerSession(c, "x")).rejects.toThrow(/不支持中途插话/)
    expect(c.sent).toEqual([])
  })

  // 这条私有扩展没有附件位。把路径拼进正文是 omni 替引擎编格式——
  // 宁可退回排队（那条路附件是完整的）
  it("带附件时拒绝，而不是把附件悄悄丢掉", async () => {
    const c = ctx({ steer: true })
    await expect(steerSession(c, "看这个", ["/tmp/a.png"])).rejects.toThrow(/不支持带附件插话/)
    expect(c.sent).toEqual([])
  })

  it("空附件数组照常发", async () => {
    const c = ctx({ steer: true })
    await steerSession(c, "x", [])
    expect(c.sent).toEqual(["session/steer"])
  })
})
