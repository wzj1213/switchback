import { describe, expect, it } from "vitest"
import {
  busy,
  gaitOf,
  homeXOf,
  lookOf,
  SIZE,
  step,
  type Gait,
  type Pet,
  type Stage,
} from "./pets.js"

const stage: Stage = { width: 600, height: 300 }
const floor = stage.height - SIZE

const air = (over: Partial<Pet> = {}): Pet => ({ x: 100, y: 0, vx: 0, vy: 0, mode: "air", ...over })

/** 跑到不动为止。返回最后的状态和用了多少帧——**帧数上限是防呆**，跑不完就是有 bug。 */
function settle(
  pet: Pet,
  homeX: number,
  gait: Gait = "walk",
  frames = 2000,
): { pet: Pet; frames: number; peak: number } {
  let cur = pet
  let peak = 0
  for (let i = 0; i < frames; i += 1) {
    if (cur.mode === "rest") return { pet: cur, frames: i, peak }
    cur = step(cur, 1 / 60, { stage, homeX, gait })
    // 落地之后还离地多高：史莱姆是蹦回去的，这个值一定大于零
    if (cur.y < floor) peak = Math.max(peak, floor - cur.y)
  }
  throw new Error(`${String(frames)} 帧还没停下来：${JSON.stringify(cur)}`)
}

describe("lookOf", () => {
  it("认得出三家，前缀匹配", () => {
    expect(lookOf("kimi").shape).toBe("slime")
    expect(lookOf("claude").shape).toBe("slime")
    expect(lookOf("grok").tone).toBe("grok")
  })

  // 同一家常有 claude / claude-code / claude-sdk 几个 id，它们是同一只
  it("同一家的几个 id 是同一只", () => {
    expect(lookOf("claude-sdk")).toEqual(lookOf("claude"))
    expect(lookOf("Kimi-Code").tone).toBe("kimi")
  })

  // 引擎注册表是开放的，「没见过的那一家」是常态不是异常
  it("没见过的给素色史莱姆，不留空位", () => {
    expect(lookOf("zcode")).toEqual({ shape: "slime", tone: "plain" })
  })
})

describe("homeXOf", () => {
  it("窝在右下角，从右往左排，顺序和清单一致", () => {
    const a = homeXOf(0, 3, stage.width)
    const b = homeXOf(1, 3, stage.width)
    const c = homeXOf(2, 3, stage.width)
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
    expect(c + SIZE).toBeLessThan(stage.width)
  })
})

describe("step", () => {
  it("窝里和被捏着的时候一动不动", () => {
    const rest: Pet = { x: 10, y: 20, vx: 999, vy: 999, mode: "rest" }
    expect(step(rest, 1 / 60, { stage, homeX: 0, gait: "walk" })).toBe(rest)
    const held: Pet = { ...rest, mode: "held" }
    expect(step(held, 1 / 60, { stage, homeX: 0, gait: "walk" })).toBe(held)
  })

  // 用户要的那一条：拉到对话框顶上松手，它掉下来
  it("从顶上放开会掉到地面，然后自己走回窝", () => {
    const home = homeXOf(2, 3, stage.width)
    const { pet } = settle(air({ x: 40, y: 0 }), home, "walk")
    expect(pet.mode).toBe("rest")
    expect(pet.y).toBe(floor)
    expect(pet.x).toBeCloseTo(home, 5)
  })

  it("弹跳会衰减，不会永远弹下去", () => {
    const { frames } = settle(air({ x: 300, y: 0 }), 300, "walk")
    expect(frames).toBeGreaterThan(10) // 真的落了一段，不是瞬移
    expect(frames).toBeLessThan(600) // 十秒之内一定停
  })

  // 用力甩出去也不能飞出活动区——那样它就再也回不来了
  it("横着甩出去会撞墙弹回来，永远留在活动区里", () => {
    let pet = air({ x: 500, y: 100, vx: 4000 })
    for (let i = 0; i < 600 && pet.mode !== "rest"; i += 1) {
      pet = step(pet, 1 / 60, { stage, homeX: 100, gait: "hop" })
      expect(pet.x).toBeGreaterThanOrEqual(0)
      expect(pet.x).toBeLessThanOrEqual(stage.width - SIZE)
      expect(pet.y).toBeGreaterThanOrEqual(0)
      expect(pet.y).toBeLessThanOrEqual(floor)
    }
  })

  it("往上甩也出不去顶", () => {
    let pet = air({ x: 200, y: 10, vy: -3000 })
    for (let i = 0; i < 60; i += 1) {
      pet = step(pet, 1 / 60, { stage, homeX: 200, gait: "hop" })
      expect(pet.y).toBeGreaterThanOrEqual(0)
    }
  })
})

describe("步态", () => {
  it("螃蟹走，史莱姆蹦", () => {
    expect(gaitOf("crab")).toBe("walk")
    expect(gaitOf("slime")).toBe("hop")
  })

  // 用户要的那一条：史莱姆不是滑回去的，是一路弹回去的
  it("史莱姆回窝的路上会离地，螃蟹全程贴着地", () => {
    const home = 500
    // 从「刚刚落稳在地上」起算，否则一开始那段自由落体会被记进回程高度
    const landed = air({ x: 60, y: floor, vy: 10 })
    const hop = settle(landed, home, "hop")
    const walk = settle(landed, home, "walk")
    expect(hop.pet.x).toBeCloseTo(home, 5)
    expect(walk.pet.x).toBeCloseTo(home, 5)
    expect(hop.peak).toBeGreaterThan(20)
    expect(walk.peak).toBe(0)
  })

  // 自己蹦的那一下落地不该再颠一下——颠了看起来就是摔的不是跳的
  it("自己蹦的一跳落地不弹", () => {
    // 正落在窝口上方：横速给 0，落点就是窝，于是「弹不弹」是这一步唯一的变量
    const landing: Pet = { x: 100, y: floor - 1, vx: 0, vy: 600, mode: "hop" }
    const next = step(landing, 1 / 60, { stage, homeX: 100, gait: "hop" })
    expect(next.mode).toBe("rest")
  })
})

describe("busy", () => {
  // 三只静止的史莱姆不该让窗口每秒醒 60 次
  it("全在窝里就是不忙", () => {
    expect(busy([{ x: 0, y: 0, vx: 0, vy: 0, mode: "rest" }])).toBe(false)
    expect(busy([{ x: 0, y: 0, vx: 0, vy: 0, mode: "held" }])).toBe(false)
    expect(busy([{ x: 0, y: 0, vx: 0, vy: 0, mode: "walk" }])).toBe(true)
    expect(busy([{ x: 0, y: 0, vx: 0, vy: 0, mode: "hop" }])).toBe(true)
  })
})
