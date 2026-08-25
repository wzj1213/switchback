import { describe, expect, it } from "vitest"
import { CLAIMS, claimedCapabilities } from "./claims.js"
import { handlesServerRequest } from "./approve.js"
import { handleNotification } from "./notify.js"
import type { NotifyContext } from "./notify.js"

/**
 * **认领实验面是有代价的**：厂商标了 experimental 就意味着它会变。
 * 所以两个方向都要卡死，见 `claims.ts` 的注释。
 */
describe("omni 认领了 codex 的哪些实验面", () => {
  it("**认了必须用**：每一条 `buys` 都要真有 handler，否则是白白把自己绑在不稳定的面上", () => {
    for (const [name, claim] of Object.entries(CLAIMS)) {
      expect(claim.buys.length, `${name} 认了却什么都没换到`).toBeGreaterThan(0)
      for (const method of claim.buys) {
        const events: string[] = []
        const ctx = {
          threadId: "t",
          codexThread: () => undefined,
          emit: () => events.push("hit"),
          turnId: () => "turn",
          inflight: new Map(),
          streamed: new Map(),
          materialized: new Set<string>(),
          mcpSeen: new Map(),
          now: () => 0,
          onSettings: () => events.push("hit"),
        } as unknown as NotifyContext
        handleNotification(ctx, method, { threadSettings: { approvalPolicy: "on-request" } })
        expect(events, `${name} 认领的 ${method} 没有人消费`).not.toEqual([])
      }
      for (const method of claim.requests ?? []) {
        expect(handlesServerRequest(method), `${name} 认领的 ${method} 没有人应答`).toBe(true)
      }
      for (const method of claim.methods ?? []) {
        expect(method, `${name} 认领的方法没有留下具体名字`).toMatch(/[/.]/)
      }
    }
  })

  it("**每一条都要说得出为什么、并留下核对过的版本**——实验面会变，不留戳等于没查过", () => {
    for (const [name, claim] of Object.entries(CLAIMS)) {
      expect(claim.why.length, `${name} 说不出为什么认它`).toBeGreaterThan(10)
      expect(claim.checked.length, `${name} 没留核对的版本`).toBeGreaterThan(10)
    }
  })

  it("握手发出去的就是这张表，不许另写一份", () => {
    expect(claimedCapabilities()).toEqual(
      { ...Object.fromEntries(Object.keys(CLAIMS).map((k) => [k, true])), requestAttestation: false },
    )
    // 空表要发空对象而不是 null——`null` 和「什么都不认领」在协议上不是一回事
    expect(typeof claimedCapabilities()).toBe("object")
  })
})
