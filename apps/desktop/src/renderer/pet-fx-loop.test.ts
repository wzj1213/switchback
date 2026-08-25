import { describe, expect, it } from "vitest"
import { createFxLoop, type FxLoopHost } from "./pet-fx-loop.js"

interface FakeClock {
  hidden: boolean
  next: number
  frames: Map<number, (at: number) => void>
  idles: Map<number, () => void>
  cleared: number[]
}

function fake(): { clock: FakeClock; host: FxLoopHost } {
  const clock: FakeClock = {
    hidden: false,
    next: 1,
    frames: new Map(),
    idles: new Map(),
    cleared: [],
  }
  return {
    clock,
    host: {
      hidden: () => clock.hidden,
      now: () => 20,
      requestFrame: (run) => {
        const id = clock.next++
        clock.frames.set(id, run)
        return id
      },
      cancelFrame: (id) => {
        clock.frames.delete(id)
      },
      setIdle: (run) => {
        const id = clock.next++
        clock.idles.set(id, run)
        return id
      },
      clearIdle: (id) => {
        clock.cleared.push(id)
        clock.idles.delete(id)
      },
    },
  }
}

function fire<T>(jobs: Map<number, T>, id: number): T {
  const job = jobs.get(id)
  if (job === undefined) throw new Error(`missing job ${String(id)}`)
  jobs.delete(id)
  return job
}

describe("pet fx loop", () => {
  it("已触发的慢拍先释放句柄，紧急唤醒不会叠出第二条 rAF，后台完全停", () => {
    const { clock, host } = fake()
    const awake: boolean[] = [false, true, true]
    const loop = createFxLoop(host, () => awake.shift() ?? false, 120)

    loop.wake()
    fire(clock.frames, 1)(10)
    expect([...clock.idles.keys()]).toEqual([2])

    fire(clock.idles, 2)()
    expect([...clock.frames.keys()]).toEqual([3])
    loop.wake()
    expect([...clock.frames.keys()]).toEqual([3])

    clock.hidden = true
    loop.pause()
    expect(clock.frames.size + clock.idles.size).toBe(0)
    loop.wake()
    expect(clock.frames.size + clock.idles.size).toBe(0)

    clock.hidden = false
    loop.wake()
    expect(clock.frames.size).toBe(1)
    loop.stop()
    expect(clock.frames.size + clock.idles.size).toBe(0)
  })

  it("尺寸变化会取消慢拍并立刻改走唯一一条 rAF", () => {
    const { clock, host } = fake()
    const loop = createFxLoop(host, () => false, 120)

    loop.wake()
    fire(clock.frames, 1)(10)
    loop.wake()

    expect(clock.cleared).toEqual([2])
    expect([...clock.frames.keys()]).toEqual([3])
    expect(clock.idles.size).toBe(0)
  })

  it("浏览器把 rAF id 溢出成 0 时也仍认得已有句柄", () => {
    const { clock, host } = fake()
    clock.next = 0
    const loop = createFxLoop(host, () => true, 120)

    loop.wake()
    loop.wake()

    expect([...clock.frames.keys()]).toEqual([0])
  })
})
