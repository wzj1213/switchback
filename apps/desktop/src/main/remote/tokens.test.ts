import { describe, expect, it } from "vitest"
import { createTokenStore, type Device, type TokenStore } from "./tokens.js"

function store(start = 1_000): { tokens: TokenStore; tick: (ms: number) => void; saved: () => readonly Device[] } {
  const clock = { at: start }
  const disk: { devices: readonly Device[] } = { devices: [] }
  const tokens = createTokenStore({
    load: () => disk.devices,
    save: (devices) => {
      disk.devices = devices.map((d) => ({ ...d }))
    },
    now: () => clock.at,
  })
  return {
    tokens,
    tick: (ms) => {
      clock.at += ms
    },
    saved: () => disk.devices,
  }
}

/** 走一遍完整配对，返回令牌。 */
function pair(tokens: TokenStore, name = "iPhone"): string {
  const { code } = tokens.startPairing()
  const claimed = tokens.claim(code, name)
  if (!claimed.ok) throw new Error(claimed.reason)
  return claimed.token
}

describe("配对码", () => {
  it("八位、只用不会看错的字符", () => {
    const { tokens } = store()
    const { code } = tokens.startPairing()
    expect(code).toHaveLength(8)
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/)
  })

  it("**新开一个就把上一个作废**——同时挂着两个有效码没有任何好处", () => {
    const { tokens } = store()
    const first = tokens.startPairing().code
    tokens.startPairing()
    expect(tokens.claim(first, "x").ok).toBe(false)
  })

  it("**用掉就作废**：一个码只换一台设备", () => {
    const { tokens } = store()
    const { code } = tokens.startPairing()
    expect(tokens.claim(code, "第一台").ok).toBe(true)
    expect(tokens.claim(code, "第二台").ok).toBe(false)
  })

  it("五分钟后过期", () => {
    const { tokens, tick } = store()
    const { code } = tokens.startPairing()
    tick(5 * 60_000)
    expect(tokens.pending()).toBeUndefined()
    expect(tokens.claim(code, "晚了").ok).toBe(false)
  })

  it("大小写与首尾空白不影响（这串是要用手打的）", () => {
    const { tokens } = store()
    const { code } = tokens.startPairing()
    expect(tokens.claim(`  ${code.toLowerCase()} `, "手打的").ok).toBe(true)
  })

  it("**没在配对时的拒绝理由，和码不对时一模一样**——分开说等于告诉对方现在有码可试", () => {
    const { tokens } = store()
    const idle = tokens.claim("ABCDEFGH", "x")
    tokens.startPairing()
    const wrong = tokens.claim("ZZZZZZZZ", "x")
    expect(idle.ok).toBe(false)
    expect(wrong.ok).toBe(false)
    expect(idle.ok === false ? idle.reason : "").toBe(wrong.ok === false ? wrong.reason : "!")
  })
})

describe("试错限速", () => {
  it("错满十次就锁一分钟，锁着时连对的码也不认", () => {
    const { tokens, tick } = store()
    const { code } = tokens.startPairing()
    for (let i = 0; i < 10; i += 1) tokens.claim("ZZZZZZZZ", "x")
    const locked = tokens.claim(code, "对的码")
    expect(locked.ok).toBe(false)
    expect(locked.ok === false ? locked.reason : "").toContain("等一分钟")
    tick(60_000)
    expect(tokens.claim(code, "过了锁定期").ok).toBe(true)
  })

  it("成功一次把失败计数清零", () => {
    const { tokens } = store()
    const first = tokens.startPairing().code
    for (let i = 0; i < 9; i += 1) tokens.claim("ZZZZZZZZ", "x")
    expect(tokens.claim(first, "对的").ok).toBe(true)
    const second = tokens.startPairing().code
    for (let i = 0; i < 9; i += 1) tokens.claim("ZZZZZZZZ", "x")
    expect(tokens.claim(second, "又对了").ok).toBe(true)
  })
})

describe("设备令牌", () => {
  it("配出来的令牌认得出，认出的是同一台设备", () => {
    const { tokens } = store()
    const token = pair(tokens, "iPhone 17")
    expect(tokens.verify(token)?.name).toBe("iPhone 17")
  })

  it("**磁盘上只有哈希，没有令牌原文**", () => {
    const { tokens, saved } = store()
    const token = pair(tokens)
    const text = JSON.stringify(saved())
    expect(text).not.toContain(token)
    expect(saved()[0]?.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("认不出的令牌返回 undefined，空串也是", () => {
    const { tokens } = store()
    pair(tokens)
    expect(tokens.verify("乱写的")).toBeUndefined()
    expect(tokens.verify("")).toBeUndefined()
  })

  it("两台设备各拿各的令牌，互不通用", () => {
    const { tokens } = store()
    const a = pair(tokens, "手机")
    const b = pair(tokens, "平板")
    expect(a).not.toBe(b)
    expect(tokens.verify(a)?.name).toBe("手机")
    expect(tokens.verify(b)?.name).toBe("平板")
  })

  it("校验时记一次「最后见到」", () => {
    const { tokens, tick } = store()
    const token = pair(tokens)
    tick(90_000)
    expect(tokens.verify(token)?.lastSeenAt).toBe(1_000 + 90_000)
  })

  it("名字空着时给个占位，过长截断", () => {
    const { tokens } = store()
    pair(tokens, "   ")
    expect(tokens.list()[0]?.name).toBe("未命名设备")
    pair(tokens, "长".repeat(200))
    expect(tokens.list()[1]?.name).toHaveLength(60)
  })
})

describe("吊销", () => {
  it("吊销一台，另一台照常", () => {
    const { tokens } = store()
    const a = pair(tokens, "丢了的手机")
    const b = pair(tokens, "还在的平板")
    const id = tokens.list().find((d) => d.name === "丢了的手机")?.id ?? ""
    expect(tokens.revoke(id)).toBe(true)
    expect(tokens.verify(a)).toBeUndefined()
    expect(tokens.verify(b)?.name).toBe("还在的平板")
  })

  it("吊销一个不存在的 id 回 false，不抛", () => {
    const { tokens } = store()
    expect(tokens.revoke("没有这个")).toBe(false)
  })

  it("全部吊销之后一个都认不出，且磁盘也清了", () => {
    const { tokens, saved } = store()
    const a = pair(tokens)
    tokens.revokeAll()
    expect(tokens.verify(a)).toBeUndefined()
    expect(saved()).toEqual([])
  })

  it("列表给的是副本——外面改了不该动到里面", () => {
    const { tokens } = store()
    const token = pair(tokens, "原名")
    const copy = tokens.list()[0]
    if (copy !== undefined) copy.name = "被改了"
    expect(tokens.verify(token)?.name).toBe("原名")
  })
})
