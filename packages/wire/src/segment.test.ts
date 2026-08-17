import { describe, expect, it } from "vitest"
import type { ChunkFrame, ServerFrame } from "./types.js"
import { createReassembler, encodeFrame } from "./segment.js"

const pong: ServerFrame = { type: "pong" }

const frameOf = (text: string): ServerFrame => ({
  type: "reset",
  reason: text,
})

/** 把一条帧编出来再原样喂回去，返回重组结果。 */
function roundTrip(frame: ServerFrame, maxChars: number): ServerFrame | string {
  const wire = encodeFrame(frame, 1, maxChars)
  const reassembler = createReassembler()
  let last: ServerFrame | string = "没有产出"
  for (const text of wire) {
    const seen = reassembler.observe(text)
    if (seen.kind === "frame") last = seen.frame
    if (seen.kind === "dropped") return seen.reason
  }
  return last
}

describe("小帧不套壳", () => {
  it("装得下就原样发一条，省掉一次解析", () => {
    const wire = encodeFrame(pong, 1)
    expect(wire).toHaveLength(1)
    expect(JSON.parse(wire[0] ?? "")).toEqual(pong)
  })
})

describe("切分与重组", () => {
  const cases: readonly { name: string; text: string; maxChars: number }[] = [
    { name: "纯 ASCII", text: "a".repeat(1000), maxChars: 100 },
    { name: "中文", text: "同文".repeat(500), maxChars: 100 },
    { name: "恰好一片", text: "b".repeat(50), maxChars: 200 },
    { name: "刚过一片", text: "c".repeat(201), maxChars: 200 },
    { name: "空字符串", text: "", maxChars: 10 },
    { name: "带引号与换行", text: '他说："行"\n然后走了\t'.repeat(80), maxChars: 60 },
  ]

  for (const { name, text, maxChars } of cases) {
    it(`${name} 原样回得来`, () => {
      expect(roundTrip(frameOf(text), maxChars)).toEqual(frameOf(text))
    })
  }

  it("**代理对不会被劈开**——半个代理对不是合法 UTF-8，发不出去", () => {
    // 每个 emoji 两个码元；切点必须避开中间
    const text = "🐳".repeat(50)
    const wire = encodeFrame(frameOf(text), 1, 21)
    expect(wire.length).toBeGreaterThan(1)
    // 孤立代理（前面没有高位的低位，或后面没有低位的高位）编不成合法 UTF-8
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u
    for (const part of wire) {
      const chunk = JSON.parse(part) as ChunkFrame
      expect(lone.test(chunk.body)).toBe(false)
    }
    expect(roundTrip(frameOf(text), 21)).toEqual(frameOf(text))
  })

  it("多片时每一片都带得齐 id/index/count", () => {
    const wire = encodeFrame(frameOf("x".repeat(500)), 7, 100)
    const chunks = wire.map((t) => JSON.parse(t) as ChunkFrame)
    expect(chunks.every((c) => c.type === "chunk" && c.id === 7)).toBe(true)
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i))
    expect(new Set(chunks.map((c) => c.count))).toEqual(new Set([chunks.length]))
  })
})

describe("坏输入一律丢掉并说清楚", () => {
  const bad: readonly { name: string; text: string; hit: string }[] = [
    { name: "不是 JSON", text: "{坏的", hit: "不是合法 JSON" },
    { name: "片数为 0", text: JSON.stringify({ type: "chunk", id: 1, index: 0, count: 0, body: "x" }), hit: "片数不合法" },
    { name: "片数过大", text: JSON.stringify({ type: "chunk", id: 1, index: 0, count: 99999, body: "x" }), hit: "片数不合法" },
    { name: "片号越界", text: JSON.stringify({ type: "chunk", id: 1, index: 5, count: 2, body: "x" }), hit: "片号越界" },
    { name: "片体不是字符串", text: JSON.stringify({ type: "chunk", id: 1, index: 0, count: 2, body: 3 }), hit: "片体不是字符串" },
  ]

  for (const { name, text, hit } of bad) {
    it(name, () => {
      const seen = createReassembler().observe(text)
      expect(seen.kind).toBe("dropped")
      expect(seen.kind === "dropped" ? seen.reason : "").toContain(hit)
    })
  }

  it("**片号跳了就整条作废**——拼出来的是一段坏 JSON，不如当场说漏了", () => {
    const reassembler = createReassembler()
    expect(reassembler.observe(JSON.stringify({ type: "chunk", id: 1, index: 0, count: 3, body: "a" })).kind).toBe("pending")
    const seen = reassembler.observe(JSON.stringify({ type: "chunk", id: 1, index: 2, count: 3, body: "c" }))
    expect(seen.kind).toBe("dropped")
    expect(seen.kind === "dropped" ? seen.reason : "").toContain("片号跳了")
  })

  it("同一条帧的片数前后不一致也作废", () => {
    const reassembler = createReassembler()
    reassembler.observe(JSON.stringify({ type: "chunk", id: 1, index: 0, count: 3, body: "a" }))
    const seen = reassembler.observe(JSON.stringify({ type: "chunk", id: 1, index: 1, count: 4, body: "b" }))
    expect(seen.kind).toBe("dropped")
  })

  it("换了 id 就从头装，旧的那条不留着", () => {
    const reassembler = createReassembler()
    reassembler.observe(JSON.stringify({ type: "chunk", id: 1, index: 0, count: 2, body: '{"type":"po' }))
    expect(reassembler.observe(JSON.stringify({ type: "chunk", id: 2, index: 0, count: 1, body: '{"type":"pong"}' })).kind).toBe("frame")
  })

  it("整帧插进来时，在装的那条作废（它已经不可能拼完了）", () => {
    const reassembler = createReassembler()
    reassembler.observe(JSON.stringify({ type: "chunk", id: 1, index: 0, count: 2, body: "half" }))
    expect(reassembler.observe(JSON.stringify(pong))).toEqual({ kind: "frame", frame: pong })
    // 旧的装配没了：再来一片就是「片号跳了」而不是接上
    const seen = reassembler.observe(JSON.stringify({ type: "chunk", id: 1, index: 1, count: 2, body: "rest" }))
    expect(seen.kind).toBe("dropped")
  })

  it("重组超过上限就丢——防的是「报 1024 片、每片撑满」", () => {
    const reassembler = createReassembler(10)
    reassembler.observe(JSON.stringify({ type: "chunk", id: 1, index: 0, count: 2, body: "x".repeat(6) }))
    const seen = reassembler.observe(JSON.stringify({ type: "chunk", id: 1, index: 1, count: 2, body: "y".repeat(6) }))
    expect(seen.kind).toBe("dropped")
    expect(seen.kind === "dropped" ? seen.reason : "").toContain("重组超过上限")
  })

  it("拼出来不是合法 JSON 时说清楚，而不是抛出去", () => {
    const reassembler = createReassembler()
    reassembler.observe(JSON.stringify({ type: "chunk", id: 1, index: 0, count: 2, body: "{坏" }))
    const seen = reassembler.observe(JSON.stringify({ type: "chunk", id: 1, index: 1, count: 2, body: "的}" }))
    expect(seen.kind).toBe("dropped")
    expect(seen.kind === "dropped" ? seen.reason : "").toContain("不是合法 JSON")
  })
})
