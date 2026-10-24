import { describe, expect, it } from "vitest"
import { AcpPromptBridge } from "./prompt.js"
import { isAsleep, SessionRevive } from "./revive.js"

/**
 * 「会话睡着了」这一句怎么认。**认得太宽会把真故障也当成可重试的**，
 * 认得太窄就等于没有——而用户在那堵墙前唯一能做的是反复重发。
 */
describe("isAsleep", () => {
  it("认得出实测那两句（ZCode，mac2）", () => {
    expect(isAsleep("session/subscribe failed: Session is not active: sess_5ff6 (code -32004)")).toBe(true)
    expect(isAsleep("zcode resume failed: Session not found: sess_5ff6")).toBe(true)
  })

  it("大小写和多余空白都不挑", () => {
    expect(isAsleep("SESSION  IS  NOT  ACTIVE")).toBe(true)
  })

  it("**别的故障一律不认**：重试救不了它们，多试一次只是多等一次", () => {
    expect(isAsleep("Method not found")).toBe(false)
    expect(isAsleep("unsupported config option or switch failed: model")).toBe(false)
    expect(isAsleep("Unsupported value: max")).toBe(false)
    // 「没有活跃会话」说的是另一件事——那时候压根没有句柄可挂
    expect(isAsleep("no active session")).toBe(false)
  })
})

/**
 * 重挂本身。`session/load` 会把整段历史重放成 `session/update`
 *（实测 ZCode 213 条，其中 3 条在回包**之后**才到），所以闸门不能跟着回包关。
 */
describe("SessionRevive", () => {
  const state = (patch: Partial<Parameters<typeof make>[0]> = {}): Parameters<typeof make>[0] => ({
    acpSession: "sess_1",
    loadSession: true,
    native: undefined,
    ...patch,
  })
  function make(
    s: { acpSession: string | undefined; loadSession: boolean; native: { meta?: Readonly<Record<string, unknown>> | undefined } | undefined },
    call: (method: string, params: unknown) => Promise<unknown> = () => Promise.resolve({}),
  ): SessionRevive {
    return new SessionRevive({ id: "acp:zcode", cwd: "/w" }, { call }, s)
  }

  it("拿当前句柄去 `session/load`，带上工作区和这家的原生审批开关", async () => {
    const seen: { method: string; params: unknown }[] = []
    await make(state({ native: { meta: { yoloMode: true } } }), (method, params) => {
      seen.push({ method, params })
      return Promise.resolve({})
    }).run()
    expect(seen[0]?.method).toBe("session/load")
    expect(seen[0]?.params).toMatchObject({ sessionId: "sess_1", cwd: "/w", _meta: { yoloMode: true } })
  })

  it("**句柄会变，所以读的时候才取**——不在构造时快照", async () => {
    const live = state()
    const seen: unknown[] = []
    const revive = make(live, (_m, params) => { seen.push(params); return Promise.resolve({}) })
    live.acpSession = "sess_2"
    await revive.run()
    expect(seen[0]).toMatchObject({ sessionId: "sess_2" })
  })

  it("没有句柄、或这家没声明 loadSession，都直接说挂不回来", async () => {
    await expect(make(state({ acpSession: undefined })).run()).rejects.toThrow("还没有会话句柄")
    await expect(make(state({ loadSession: false })).run()).rejects.toThrow("loadSession")
  })

  it("重挂期间 `replaying` 为真，结束后一定复位——哪怕 load 抛了", async () => {
    const revive = make(state(), () => Promise.reject(new Error("炸了")))
    expect(revive.replaying).toBe(false)
    await expect(revive.run()).rejects.toThrow("炸了")
    expect(revive.replaying).toBe(false)
  })
})

/**
 * 端到端：发失败 → 认出睡着了 → 挂回来 → **重发一次**。
 * 挂不回来时两条原因一起报——光说「重新挂上失败」会把原来那句藏掉，
 * 而排查要的恰恰是原来那一句。
 */
describe("prompt 撞上睡着的会话", () => {
  interface Pending { method: string; reject: (e: unknown) => void; resolve: (v: unknown) => void }

  function bridge(revive: (() => Promise<void>) | undefined, sink: { calls: Pending[]; failed: string[] }): AcpPromptBridge {
    return new AcpPromptBridge({
      id: "acp:zcode",
      state: { acpSession: "sess_1", turn: undefined as string | undefined, caps: { attachments: false } },
      now: () => 0,
      promptMeta: undefined,
      begin: undefined,
      rpc: { call: (method) => new Promise((resolve, reject) => { sink.calls.push({ method, resolve, reject }) }) },
      complete: () => undefined,
      fail: (_turnId, message) => { sink.failed.push(message) },
      ...(revive === undefined ? {} : { revive }),
    })
  }

  const flush = async (): Promise<void> => { for (let i = 0; i < 8; i += 1) await Promise.resolve() }
  const ASLEEP = "session/subscribe failed: Session is not active: sess_1"

  it("挂回来之后原样重发一次，用户什么都不用做", async () => {
    const sink = { calls: [] as Pending[], failed: [] as string[] }
    let revived = 0
    await bridge(() => { revived += 1; return Promise.resolve() }, sink).prompt("你好", "turn-1")
    sink.calls[0]?.reject(new Error(ASLEEP))
    await flush()
    expect(revived).toBe(1)
    expect(sink.calls).toHaveLength(2)
    expect(sink.calls[1]?.method).toBe("session/prompt")
    expect(sink.failed).toEqual([])
  })

  it("**只重一次**：挂回来还是同一堵墙就别再转了", async () => {
    const sink = { calls: [] as Pending[], failed: [] as string[] }
    await bridge(() => Promise.resolve(), sink).prompt("你好", "turn-1")
    sink.calls[0]?.reject(new Error(ASLEEP))
    await flush()
    sink.calls[1]?.reject(new Error(ASLEEP))
    await flush()
    expect(sink.calls).toHaveLength(2)
    expect(sink.failed).toEqual([ASLEEP])
  })

  it("挂不回来时两条原因一起说——原来那句不能被藏掉", async () => {
    const sink = { calls: [] as Pending[], failed: [] as string[] }
    await bridge(() => Promise.reject(new Error("Session not found: sess_1")), sink).prompt("你好", "turn-1")
    sink.calls[0]?.reject(new Error(ASLEEP))
    await flush()
    expect(sink.failed[0]).toContain("Session is not active")
    expect(sink.failed[0]).toContain("重新挂上也失败了")
    expect(sink.failed[0]).toContain("Session not found")
  })

  it("别的故障原样报，一次都不重试", async () => {
    const sink = { calls: [] as Pending[], failed: [] as string[] }
    let revived = 0
    await bridge(() => { revived += 1; return Promise.resolve() }, sink).prompt("你好", "turn-1")
    sink.calls[0]?.reject(new Error("Method not found"))
    await flush()
    expect(revived).toBe(0)
    expect(sink.calls).toHaveLength(1)
    expect(sink.failed).toEqual(["Method not found"])
  })

  it("没接重挂能力的驱动退回老行为", async () => {
    const sink = { calls: [] as Pending[], failed: [] as string[] }
    await bridge(undefined, sink).prompt("你好", "turn-1")
    sink.calls[0]?.reject(new Error(ASLEEP))
    await flush()
    expect(sink.calls).toHaveLength(1)
    expect(sink.failed).toEqual([ASLEEP])
  })
})
