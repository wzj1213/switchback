import { describe, expect, it } from "vitest"
import { begin, BPT_GUESS, clearRun, createRun, feed, report, settle, type Run } from "./bench.js"

/**
 * 跑一轮。时刻全由这里给——`bench.ts` 不读时钟，所以每条用例都是确定的。
 *
 * `chunks` 是 `[时刻, 字节]`：**时刻是「到我这儿的时刻」**，不是引擎那边的墙钟
 *（理由在 `useFlow.ts` 里那段）。
 */
function turn(
  run: Run,
  spec: { from: number; chunks: readonly (readonly [number, number])[]; tokens?: number; till: number },
): Run {
  begin(run, spec.from)
  for (const [at, bytes] of spec.chunks) feed(run, at, bytes)
  if (spec.tokens !== undefined) report(run, spec.tokens)
  settle(run, spec.till)
  return run
}

describe("业界口径", () => {
  it("t/s = 生成量 ÷（首字 → 末字）——**分母不含 TTFT**", () => {
    // 800ms 才出第一个字，然后 2 秒里吐了 200 token
    const run = turn(createRun(), {
      from: 1000,
      chunks: [
        [1800, 300],
        [3800, 300],
      ],
      tokens: 200,
      till: 3900,
    })
    // 排除 TTFT：200 / 2s = 100。含 TTFT 的话是 200 / 2.9s ≈ 69——**不是同一个数**
    expect(run.done?.tps).toBeCloseTo(100, 6)
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

  it("引擎报了生成量就是真数，没报就是估的——**波浪号靠这一位**", () => {
    const real = turn(createRun(), { from: 0, chunks: [[100, 640]], tokens: 200, till: 1100 })
    expect(real.done?.exact).toBe(true)
    expect(real.done?.tokens).toBe(200)

    const guess = turn(createRun(), { from: 0, chunks: [[100, 640]], till: 1100 })
    expect(guess.done?.exact).toBe(false)
    // 没有真数时按出厂常数折：640 / 3.2 = 200
    expect(guess.done?.tokens).toBe(Math.round(640 / BPT_GUESS))
  })

  it("首末同刻（一批就收工）退回端到端口径，而不是算出个无穷", () => {
    const run = turn(createRun(), { from: 1000, chunks: [[1500, 320]], tokens: 100, till: 2000 })
    expect(Number.isFinite(run.done?.tps ?? Infinity)).toBe(true)
    expect(run.done?.tps).toBeCloseTo(100, 6) // 100 token / 整轮 1 秒
  })

  it("收工前那段静默不算进生成时长——「想了很久才收工」不该被记成「吐得慢」", () => {
    const quick = turn(createRun(), { from: 0, chunks: [[100, 320], [1100, 320]], tokens: 100, till: 1200 })
    const stalled = turn(createRun(), { from: 0, chunks: [[100, 320], [1100, 320]], tokens: 100, till: 9000 })
    expect(stalled.done?.tps).toBeCloseTo(quick.done?.tps ?? 0, 6)
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
  it("拿真数把字节/token 往真相上带：一轮一步，越跑越准", () => {
    const run = createRun()
    // 每轮都是 1000 字节 / 200 token = 5.0 字节每 token（一段英文该有的样子）
    const step = (i: number): number => {
      turn(run, { from: i * 9000, chunks: [[i * 9000 + 100, 1000]], tokens: 200, till: i * 9000 + 1100 })
      return run.bpt
    }
    const walk = [step(0), step(1), step(2), step(3), step(4)]
    // 单调朝真相走，一步都不许回头
    expect(walk[0]).toBeGreaterThan(BPT_GUESS)
    for (const [i, bpt] of walk.entries()) {
      if (i > 0) expect(bpt).toBeGreaterThan(walk[i - 1] ?? 0)
      expect(bpt).toBeLessThanOrEqual(5)
    }
    // 五轮之后落在真相的 2% 以内——够了：这个数是拿来估的，不是拿来对账的
    expect(walk.at(-1) ?? 0).toBeGreaterThan(5 * 0.98)
  })

  it("**一轮只学一次**：用量迟到导致重算时不会把同一个样本学两遍", () => {
    const once = createRun()
    turn(once, { from: 0, chunks: [[100, 1000]], tokens: 200, till: 1100 })

    const twice = createRun()
    begin(twice, 0)
    feed(twice, 100, 1000)
    settle(twice, 1100)
    report(twice, 200)
    report(twice, 200)
    expect(twice.bpt).toBeCloseTo(once.bpt, 10)
  })

  it("离谱的样本一概不要——**一个坏样本会污染之后每一帧**", () => {
    const run = createRun()
    // kimi 那种把会话累计当成一轮生成量报上来的：500 字节配 900000 token
    turn(run, { from: 0, chunks: [[100, 500]], tokens: 900000, till: 1100 })
    expect(run.bpt).toBe(BPT_GUESS)
    // 反过来也一样：一轮只吐两个字，比值高得没有意义
    turn(run, { from: 2000, chunks: [[2100, 400]], tokens: 2, till: 3000 })
    expect(run.bpt).toBe(BPT_GUESS)
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
    expect(run.bytes).toBe(0)
  })

  it("换会话连学出来的常数一起清——它是跟着上一家学的", () => {
    const run = createRun()
    turn(run, { from: 0, chunks: [[100, 1000]], tokens: 200, till: 1100 })
    expect(run.bpt).not.toBe(BPT_GUESS)
    clearRun(run)
    expect(run.bpt).toBe(BPT_GUESS)
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
    // 首末同刻且 till === from：解码时长和端到端都是 0
    settle(run, 2000)
    expect(run.done).toBe(first)
  })
})
