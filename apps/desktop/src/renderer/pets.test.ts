import { describe, expect, it } from "vitest"
import { bump } from "./petBump.js"
import {
  busy,
  hitOf,
  columnRightOf,
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

const air = (over: Partial<Pet> = {}): Pet => ({
  x: 100,
  y: 0,
  vx: 0,
  vy: 0,
  spin: 0,
  mode: "air",
  ...over,
})

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

describe("columnRightOf", () => {
  // 这一条是从真机上看出来的：窗口一拉宽，输入框还在中间 760 居中，
  // 而窝跟着活动区的右墙跑到了卡片外面——那几只就站到了空气里
  it("窗口比内容列宽时，右缘在中间那一列上，不在右墙上", () => {
    const right = columnRightOf(1174, 760, 16)
    expect(right).toBeCloseTo((1174 + 760) / 2, 5)
    expect(right).toBeLessThan(1174)
  })

  it("窗口比内容列窄时，内容列就是整块地减掉两边内边距", () => {
    expect(columnRightOf(600, 760, 16)).toBeCloseTo(600 - 16, 5)
  })

  // 正好等宽那一刻不能跳一下
  it("两条边重合时接得上", () => {
    expect(columnRightOf(760 + 32, 760, 16)).toBeCloseTo(760 + 32 - 16, 5)
  })
})

describe("homeXOf", () => {
  it("窝在右下角，从右往左排，顺序和清单一致", () => {
    const right = columnRightOf(stage.width, 760, 16)
    const a = homeXOf(0, 3, right)
    const b = homeXOf(1, 3, right)
    const c = homeXOf(2, 3, right)
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
    expect(c + SIZE).toBeLessThan(right)
  })
})

describe("step", () => {
  it("窝里和被捏着的时候一动不动", () => {
    const rest: Pet = { x: 10, y: 20, vx: 999, vy: 999, spin: 0, mode: "rest" }
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
    const landing: Pet = { x: 100, y: floor - 1, vx: 0, vy: 600, spin: 0, mode: "hop" }
    const next = step(landing, 1 / 60, { stage, homeX: 100, gait: "hop" })
    expect(next.mode).toBe("rest")
  })
})

describe("翻滚与互撞", () => {
  // 用力甩出去要看得出在翻，轻轻放下不该歪
  it("甩得快才翻，慢速下落姿态不变", () => {
    const fast = step(air({ x: 200, y: 40, vx: 900 }), 1 / 60, { stage, homeX: 200, gait: "hop" })
    expect(Math.abs(fast.spin)).toBeGreaterThan(1)
    const slow = step(air({ x: 200, y: 40, vx: 60 }), 1 / 60, { stage, homeX: 200, gait: "hop" })
    expect(slow.spin).toBe(0)
  })

  // 翻着落地不能就那么歪着待在窝里
  it("落地会把姿态转正，转正之前不歇", () => {
    let pet: Pet = { x: 200, y: floor, vx: 0, vy: 0, spin: 140, mode: "walk" }
    for (let i = 0; i < 200 && pet.mode !== "rest"; i += 1) {
      pet = step(pet, 1 / 60, { stage, homeX: 200, gait: "walk" })
    }
    expect(pet.mode).toBe("rest")
    expect(pet.spin).toBe(0)
  })

  it("飞过来的会把窝里那只撞飞", () => {
    const hitter: Pet = { x: 100, y: floor, vx: 800, vy: 0, spin: 0, mode: "air" }
    const victim: Pet = { x: 110, y: floor, vx: 0, vy: 0, spin: 0, mode: "rest" }
    const [a, b] = bump([hitter, victim])
    expect(b?.mode).toBe("air")
    expect(b?.vx).toBeGreaterThan(0)
    expect(b?.vy).toBeLessThan(0) // 被顶起来一点，不是贴地平推
    expect(a?.vx).toBeLessThan(hitter.vx) // 撞人的自己也慢下来
  })

  it("离得远就不算碰上", () => {
    const fast: Pet = { x: 100, y: floor, vx: 800, vy: 0, spin: 0, mode: "air" }
    const far: Pet = { x: 400, y: floor, vx: 0, vy: 0, spin: 0, mode: "rest" }
    expect(bump([fast, far])[1]?.mode).toBe("rest")
  })

  it("蹭一下只是把它推开，不顶起来——一脚踹飞的反应配不上一次擦肩", () => {
    const slow: Pet = { x: 100, y: floor, vx: 40, vy: 0, spin: 0, mode: "air" }
    const near: Pet = { x: 110, y: floor, vx: 0, vy: 0, spin: 0, mode: "rest" }
    const [, b] = bump([slow, near])
    expect(b?.vy).toBe(0) // 没被顶起来
    expect(b?.x).toBeGreaterThan(near.x) // 但确实被推开了，不再叠在一起
  })

  it("被推开的那只按自己的步态回窝：史莱姆是蹦回去的，不是贴地滑回去", () => {
    const rock: Pet = { x: 100, y: floor, vx: 0, vy: 0, spin: 0, mode: "held" }
    const slime: Pet = { x: 112, y: floor, vx: 0, vy: 0, spin: 0, mode: "rest" }
    const pushed = bump([rock, slime])[1]
    expect(pushed?.mode).toBe("air") // 交给落地那一段去挑走还是蹦
    const next = step(pushed ?? slime, 1 / 60, { stage, homeX: 400, gait: "hop" })
    expect(next.mode).toBe("hop")
  })

  it("撞完两只不再重叠——叠在一起看起来是一只长了两个头", () => {
    const a: Pet = { x: 100, y: floor, vx: 700, vy: 0, spin: 0, mode: "air" }
    const b: Pet = { x: 112, y: floor, vx: 0, vy: 0, spin: 0, mode: "rest" }
    const [na, nb] = bump([a, b])
    expect(Math.abs((nb?.x ?? 0) - (na?.x ?? 0))).toBeGreaterThanOrEqual(SIZE)
  })

  it("两只都在飞也会撞：同时甩出去的不该互相穿过去", () => {
    const l: Pet = { x: 100, y: 40, vx: 600, vy: 0, spin: 0, mode: "air" }
    const r: Pet = { x: 118, y: 40, vx: -600, vy: 0, spin: 0, mode: "air" }
    const [na, nb] = bump([l, r])
    expect(na?.vx).toBeLessThan(0) // 撞完各自往回弹
    expect(nb?.vx).toBeGreaterThan(0)
  })

  it("撞得越狠飞得越远——快慢的差别由速度说，不由常数说", () => {
    const victim = (): Pet => ({ x: 110, y: floor, vx: 0, vy: 0, spin: 0, mode: "rest" })
    const soft = bump([{ x: 100, y: floor, vx: 300, vy: 0, spin: 0, mode: "air" }, victim()])
    const hard = bump([{ x: 100, y: floor, vx: 900, vy: 0, spin: 0, mode: "air" }, victim()])
    expect(hard[1]?.vx ?? 0).toBeGreaterThan((soft[1]?.vx ?? 0) * 2)
  })

  it("捏在手里那只推不动、也不吃速度——它是块石头，可以当推土机", () => {
    const rock: Pet = { x: 100, y: floor, vx: 0, vy: 0, spin: 0, mode: "held" }
    const there: Pet = { x: 112, y: floor, vx: 0, vy: 0, spin: 0, mode: "rest" }
    const [na, nb] = bump([rock, there])
    expect(na).toEqual(rock)
    expect(nb?.x).toBeGreaterThan(there.x)
  })

  it("从右往左撞也得推对方向——法线漏乘符号时，两只会朝着彼此推，越推越进去", () => {
    const hitter: Pet = { x: 120, y: floor, vx: -800, vy: 0, spin: 0, mode: "air" }
    const victim: Pet = { x: 110, y: floor, vx: 0, vy: 0, spin: 0, mode: "rest" }
    const [a, b] = bump([hitter, victim])
    expect(b?.vx).toBeLessThan(0) // 被打的往左飞
    expect(a?.x).toBeGreaterThan(hitter.x) // 打人的往右退，不是继续往左钻
    expect((a?.x ?? 0) - (b?.x ?? 0)).toBeGreaterThanOrEqual(SIZE)
  })

  it("抡着一只去砸：手里那只带着速度，砸中的会被掀飞（贴着慢慢蹭则不会）", () => {
    const there = (): Pet => ({ x: 112, y: floor, vx: 0, vy: 0, spin: 0, mode: "rest" })
    const swung: Pet = { x: 100, y: floor, vx: 900, vy: 0, spin: 0, mode: "held" }
    const crept: Pet = { x: 100, y: floor, vx: 0, vy: 0, spin: 0, mode: "held" }
    expect(bump([swung, there()])[1]?.vy).toBeLessThan(0) // 被掀起来
    expect(bump([crept, there()])[1]?.vy).toBe(0) // 只是被推开
  })

  it("推土机能一路犁开一排：第一只被推开，它再推第二只", () => {
    const rock: Pet = { x: 100, y: floor, vx: 0, vy: 0, spin: 0, mode: "held" }
    const one: Pet = { x: 112, y: floor, vx: 0, vy: 0, spin: 0, mode: "rest" }
    const two: Pet = { x: 124, y: floor, vx: 0, vy: 0, spin: 0, mode: "rest" }
    const [, a, b] = bump([rock, one, two])
    expect(a?.x).toBeGreaterThan(one.x)
    // 第二只也得让开，否则一排全叠在第一只身上，看着是一坨
    expect(b?.x).toBeGreaterThan(two.x)
  })

  it("两只都在地上蹭的时候互相穿过去——互相推的话谁也走不回窝，rAF 也就停不掉", () => {
    const l: Pet = { x: 100, y: floor, vx: 0, vy: 0, spin: 0, mode: "walk" }
    const r: Pet = { x: 112, y: floor, vx: 0, vy: 0, spin: 0, mode: "walk" }
    expect(bump([l, r])).toEqual([l, r])
  })

  it("回窝路上没有碰撞体积：蹦回去的那只不会一路把窝里的撞开", () => {
    const back: Pet = { x: 100, y: floor - 20, vx: 300, vy: 0, spin: 0, mode: "hop" }
    const home: Pet = { x: 112, y: floor, vx: 0, vy: 0, spin: 0, mode: "rest" }
    expect(bump([back, home])).toEqual([back, home])
  })

  it("在飞的也撞不着正在回窝的那只——它已经在让路了", () => {
    const thrown: Pet = { x: 100, y: floor, vx: 800, vy: 0, spin: 0, mode: "air" }
    const going: Pet = { x: 112, y: floor, vx: -50, vy: 0, spin: 0, mode: "walk" }
    expect(bump([thrown, going])).toEqual([thrown, going])
  })

  it("但你手里那只照样推得动正在回窝的——你的手是实的", () => {
    const rock: Pet = { x: 100, y: floor, vx: 0, vy: 0, spin: 0, mode: "held" }
    const going: Pet = { x: 112, y: floor, vx: -50, vy: 0, spin: 0, mode: "walk" }
    expect(bump([rock, going])[1]?.x).toBeGreaterThan(going.x)
  })
})

describe("busy", () => {
  // 三只静止的史莱姆不该让窗口每秒醒 60 次
  it("全在窝里就是不忙", () => {
    expect(busy([{ x: 0, y: 0, vx: 0, vy: 0, spin: 0, mode: "rest" }])).toBe(false)
    // 捏着的那只**算在动**：碰撞只在帧循环里算，循环停了就推不动别人
    expect(busy([{ x: 0, y: 0, vx: 0, vy: 0, spin: 0, mode: "held" }])).toBe(true)
    expect(busy([{ x: 0, y: 0, vx: 0, vy: 0, spin: 0, mode: "walk" }])).toBe(true)
    expect(busy([{ x: 0, y: 0, vx: 0, vy: 0, spin: 0, mode: "hop" }])).toBe(true)
  })
})

describe("这一帧挨了哪一下", () => {
  const bounds = { floor, right: stage.width - SIZE }
  const p = (over: Partial<Pet>): Pet => ({ x: 200, y: floor, vx: 0, vy: 0, spin: 0, mode: "air", ...over })

  it("砸到地上：算的是砸下来那一刻的速度，方向是竖的", () => {
    const was = p({ y: floor - 5, vy: 900 })
    const now = p({ y: floor, vy: 0 })
    expect(hitOf(was, now, now, bounds)).toEqual({ speed: 900, axis: "y" })
  })

  it("轻轻放下不算挨了一下", () => {
    const was = p({ y: floor - 1, vy: 80 })
    const now = p({ y: floor, vy: 0 })
    expect(hitOf(was, now, now, bounds)).toBeUndefined()
  })

  it("撞到墙：横速被翻了向，而且人确实贴着墙", () => {
    const was = p({ x: 4, vx: -600 })
    const now = p({ x: 0, vx: 250 })
    expect(hitOf(was, now, now, bounds)).toEqual({ speed: 600, axis: "x" })
  })

  it("落在窝那边掉头往回蹦，不算撞墙——只看翻向会把它误判成撞墙", () => {
    const was = p({ x: 300, vx: -600 })
    const now = p({ x: 300, vx: 250 })
    expect(hitOf(was, now, now, bounds)).toBeUndefined()
  })

  it("撞到同伴：看 `bump` 把速度改了多少，方向取变得多的那条轴", () => {
    const was = p({ vx: 500 })
    const stepped = p({ vx: 500 })
    const now = p({ vx: 60 })
    expect(hitOf(was, stepped, now, bounds)).toEqual({ speed: 440, axis: "x" })
  })
})
