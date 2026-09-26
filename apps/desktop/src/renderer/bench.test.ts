import { describe, expect, it } from "vitest"
import { begin, clearRun, createRun, feed, pause, report, SCALE_GUESS, settle, speedOf, type Run } from "./bench.js"

/**
 * 跑一轮。时刻全由这里给——`bench.ts` 不读时钟，所以每条用例都是确定的。
 *
 * `chunks` 是 `[时刻, 估出来的 token]`：**时刻是「到我这儿的时刻」**，不是引擎那边的墙钟
 *（理由在 `useFlow.ts` 里那段）。
 */
function turn(
  run: Run,
  spec: { from: number; chunks: readonly (readonly [number, number])[]; tokens?: number; till: number },
): Run {
  begin(run, spec.from)
  for (const [at, est] of spec.chunks) feed(run, at, est)
  if (spec.tokens !== undefined) report(run, spec.tokens)
  settle(run, spec.till)
  return run
}

/** 从 `at` 起每 `every` 毫秒到一批、每批 `est`，一共 `n` 批。 */
function burst(at: number, n: number, every: number, est: number): (readonly [number, number])[] {
  return Array.from({ length: n }, (_, i) => [at + i * every, est] as const)
}

describe("业界口径", () => {
  it("tok/s = 生成量 ÷ 真在出字的时间——**分母不含 TTFT**", () => {
    // 800ms 才出第一个字，然后 2 秒里每 200ms 到 50 个 token
    const run = turn(createRun(), { from: 1000, chunks: burst(1800, 11, 200, 50), tokens: 550, till: 3900 })
    // 头一批的时长没法量（它是在等首字之后到的），不进速度的账：500 / 2s = 250
    expect(run.done?.tps).toBeCloseTo(250, 6)
  })

  it("**中途停下来调工具的那段不算**：一轮里停了十秒，速度不该被拖成个位数", () => {
    const chunks = [...burst(100, 6, 200, 50), ...burst(11_100, 6, 200, 50)]
    const run = turn(createRun(), { from: 0, chunks, tokens: 600, till: 12_200 })
    // 两段各 1 秒、各算 5 批：500 / 2s = 250。按「首字到末字」算的话是 600 / 12s = 50
    expect(run.done?.tps).toBeCloseTo(250, 6)
  })

  it("中间插了一次工具调用：**哪怕只停了半秒**，那段也不算出字时间", () => {
    const run = createRun()
    begin(run, 0)
    for (const [at, est] of burst(100, 6, 200, 50)) feed(run, at, est)
    pause(run)
    for (const [at, est] of burst(1600, 6, 200, 50)) feed(run, at, est)
    report(run, 600)
    settle(run, 2700)
    // 两段各 1 秒、各算 5 批：500 / 2s = 250。不认这次停顿的话那半秒也算进去：550 / 2.5s = 220
    expect(run.done?.tps).toBeCloseTo(250, 6)
  })

  it("TTFT 单列，而且是**第一个**字不是最后一批", () => {
    const run = turn(createRun(), {
      from: 1000,
      chunks: [
        [1620, 100],
        [2000, 100],
        [3000, 100],
      ],
      tokens: 60,
      till: 3100,
    })
    expect(run.done?.ttft).toBeCloseTo(0.62, 6)
  })

  it("引擎报了生成量就是真数，没报就是估的——**≈ 靠这一位**", () => {
    const real = turn(createRun(), { from: 0, chunks: [[100, 640]], tokens: 200, till: 1100 })
    expect(real.done?.exact).toBe(true)
    expect(real.done?.tokens).toBe(200)

    const guess = turn(createRun(), { from: 0, chunks: [[100, 640]], till: 1100 })
    expect(guess.done?.exact).toBe(false)
    // 没有真数时按出厂倍率折
    expect(guess.done?.tokens).toBe(Math.round(640 * SCALE_GUESS))
  })

  it("一批就收工：出字时长攒不够，退回端到端口径，而不是算出个无穷", () => {
    const run = turn(createRun(), { from: 1000, chunks: [[1500, 320]], tokens: 100, till: 2000 })
    expect(Number.isFinite(run.done?.tps ?? Infinity)).toBe(true)
    expect(run.done?.tps).toBeCloseTo(100, 6) // 100 token / 整轮 1 秒
  })

  it("收工前那段静默不算进生成时长——「想了很久才收工」不该被记成「吐得慢」", () => {
    const quick = turn(createRun(), { from: 0, chunks: burst(100, 6, 200, 50), tokens: 300, till: 1200 })
    const stalled = turn(createRun(), { from: 0, chunks: burst(100, 6, 200, 50), tokens: 300, till: 9000 })
    expect(stalled.done?.tps).toBeCloseTo(quick.done?.tps ?? 0, 6)
  })
})

describe("跑着时的读数", () => {
  it("和收工后同一个口径；出字时长不够 400ms 时不给数", () => {
    const run = createRun()
    begin(run, 0)
    feed(run, 100, 50)
    feed(run, 300, 50)
    expect(speedOf(run)).toBeUndefined()
    feed(run, 500, 50)
    // 400ms 里到手 100（头一批不算）：250 tok/s
    expect(speedOf(run)).toBeCloseTo(250, 6)
  })

  it("没开轮次就没有读数", () => {
    expect(speedOf(createRun())).toBeUndefined()
  })
})

describe("用量迟到", () => {
  it("收工之后才报生成量，照样把估数换成真数", () => {
    const run = createRun()
    begin(run, 0)
    feed(run, 100, 640)
    feed(run, 1100, 640)
    settle(run, 1200)
    expect(run.done?.exact).toBe(false)
    report(run, 200)
    expect(run.done?.exact).toBe(true)
    expect(run.done?.tokens).toBe(200)
  })

  it("收工之后到的字不算：那已经不是这一轮的事了", () => {
    const run = turn(createRun(), { from: 0, chunks: [[100, 320]], tokens: 100, till: 1000 })
    const before = run.done?.tokens
    feed(run, 2000, 99999)
    expect(run.done?.tokens).toBe(before)
  })
})

describe("校准", () => {
  it("拿真数把倍率往真相上带：一轮一步，越跑越准", () => {
    const run = createRun()
    // 每轮都是估 1000、真 800：这家分词器比通用的省两成
    const step = (i: number): number => {
      turn(run, { from: i * 9000, chunks: [[i * 9000 + 100, 1000]], tokens: 800, till: i * 9000 + 1100 })
      return run.scale
    }
    const walk = [step(0), step(1), step(2), step(3), step(4)]
    // 单调朝真相走，一步都不许回头
    expect(walk[0]).toBeLessThan(SCALE_GUESS)
    for (const [i, scale] of walk.entries()) {
      if (i > 0) expect(scale).toBeLessThan(walk[i - 1] ?? 0)
      expect(scale).toBeGreaterThanOrEqual(0.8)
    }
    // 五轮之后落在真相的 2% 以内——够了：这个数是拿来估的，不是拿来对账的
    expect(walk.at(-1) ?? 0).toBeLessThan(0.8 * 1.02)
  })

  it("**一轮只学一次**：用量迟到导致重算时不会把同一个样本学两遍", () => {
    const once = createRun()
    turn(once, { from: 0, chunks: [[100, 1000]], tokens: 800, till: 1100 })

    const twice = createRun()
    begin(twice, 0)
    feed(twice, 100, 1000)
    settle(twice, 1100)
    report(twice, 800)
    report(twice, 800)
    expect(twice.scale).toBeCloseTo(once.scale, 10)
  })

  it("离谱的样本一概不要——**一个坏样本会污染之后每一帧**", () => {
    const run = createRun()
    // kimi 那种把会话累计当成一轮生成量报上来的
    turn(run, { from: 0, chunks: [[100, 500]], tokens: 900000, till: 1100 })
    expect(run.scale).toBe(SCALE_GUESS)
    // 反过来也一样：估了 400，引擎说只生成了 2 个
    turn(run, { from: 2000, chunks: [[2100, 400]], tokens: 2, till: 3000 })
    expect(run.scale).toBe(SCALE_GUESS)
  })
})

describe("边界", () => {
  it("一个字都没吐的轮次不覆盖上一轮的成绩——假的零比旧的真数糟", () => {
    const run = createRun()
    turn(run, { from: 0, chunks: [[100, 640]], tokens: 200, till: 1100 })
    const kept = run.done
    turn(run, { from: 2000, chunks: [], till: 2500 })
    expect(run.done).toBe(kept)
  })

  it("没开轮次就来的字和用量一律不认", () => {
    const run = createRun()
    feed(run, 100, 999)
    report(run, 999)
    settle(run, 200)
    expect(run.done).toBeUndefined()
    expect(run.est).toBe(0)
  })

  it("换会话连学出来的倍率一起清——它是跟着上一家学的", () => {
    const run = createRun()
    turn(run, { from: 0, chunks: [[100, 1000]], tokens: 800, till: 1100 })
    expect(run.scale).not.toBe(SCALE_GUESS)
    clearRun(run)
    expect(run.scale).toBe(SCALE_GUESS)
    expect(run.done).toBeUndefined()
  })
})

describe("靶上那行数不许是负的、也不许是 NaN", () => {
  it("**首字延迟夹在 0 以上**：印到画面上的数，宁可是 0.00s 也不能是负的", () => {
    const run = createRun()
    begin(run, 5000)
    // 首字的时刻比开轮还早——正常路径下不会发生（同一个 performance.now），
    // 但只要有一处拿错了钟（比如 `event.at` 那个 Date.now 系）就会
    feed(run, 1000, 40)
    settle(run, 6000)
    expect(run.done?.ttft).toBeGreaterThanOrEqual(0)
  })

  it("时长非正就不留成绩，保留上一轮那个真数", () => {
    const run = createRun()
    begin(run, 1000)
    feed(run, 1000, 40)
    report(run, 10)
    settle(run, 1000)
    const first = run.done
    begin(run, 2000)
    feed(run, 2000, 40)
    // 首末同刻且 till === from：出字时长和端到端都是 0
    settle(run, 2000)
    expect(run.done).toBe(first)
  })
})
