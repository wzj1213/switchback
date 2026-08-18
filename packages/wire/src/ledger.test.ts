import { describe, expect, it } from "vitest"
import type { Event } from "@omni/protocol"
import { createLedger, type Ledger } from "./ledger.js"

/** 这一次运行的代号。测试里固定一个，跨运行的用例自己换。 */
const RUN = "run-a"

const ev = (n: number): Event => ({ type: "item.delta", at: n, itemId: "i", append: String(n) })

function feed(ledger: Ledger, count: number): void {
  for (let i = 1; i <= count; i += 1) ledger.seal([ev(i)])
}

describe("编号", () => {
  it("从 1 开始，连续，跨批不断", () => {
    const ledger = createLedger(RUN)
    expect(ledger.seal([ev(1), ev(2)]).map((s) => s.seq)).toEqual([1, 2])
    expect(ledger.seal([ev(3)]).map((s) => s.seq)).toEqual([3])
    expect(ledger.latest()).toBe(3)
  })

  it("空批不占号——发一个空数组不该让对方以为漏了一条", () => {
    const ledger = createLedger(RUN)
    ledger.seal([ev(1)])
    expect(ledger.seal([])).toEqual([])
    expect(ledger.latest()).toBe(1)
  })
})

describe("补发", () => {
  it("没落后就返回空，不是 undefined——「不用补」和「补不了」是两回事", () => {
    const ledger = createLedger(RUN)
    feed(ledger, 3)
    expect(ledger.since(3, RUN)).toEqual([])
  })

  it("落后几条就补几条", () => {
    const ledger = createLedger(RUN)
    feed(ledger, 5)
    expect(ledger.since(2, RUN)?.map((s) => s.seq)).toEqual([3, 4, 5])
  })

  it("从头补：一个全新的订阅者报 0", () => {
    const ledger = createLedger(RUN)
    feed(ledger, 3)
    expect(ledger.since(0, RUN)?.map((s) => s.seq)).toEqual([1, 2, 3])
  })

  it("**缺口太老就明说补不了，绝不补一半**——补一半的界面看起来是好的，那才危险", () => {
    const ledger = createLedger(RUN, 10)
    feed(ledger, 30)
    expect(ledger.since(5, RUN)).toBeUndefined()
    expect(ledger.since(20, RUN)?.map((s) => s.seq)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
  })

  it("**对方报的号比我们发过的还大 → 它来自上一次运行**，只能全量重来", () => {
    const ledger = createLedger(RUN)
    feed(ledger, 3)
    expect(ledger.since(99, RUN)).toBeUndefined()
  })

  it("一条都没发过时，落后的订阅者也补不了", () => {
    const ledger = createLedger(RUN)
    expect(ledger.since(0, RUN)).toEqual([])
    expect(ledger.since(1, RUN)).toBeUndefined()
  })

  it("没人 join 时按条数裁剪——补得动的恰好是最后那几条", () => {
    const ledger = createLedger(RUN, 10)
    feed(ledger, 1000)
    expect(ledger.since(990, RUN)?.length).toBe(10)
    expect(ledger.since(989, RUN)).toBeUndefined()
  })
})

describe("按确认保留", () => {
  it("**join 进来的客户端没确认，就一条都不许丢**——哪怕早就超过了它自己的批量", () => {
    const ledger = createLedger(RUN, 10)
    ledger.join("手机")
    feed(ledger, 10)
    // 上限是 10，正好没超；关键是 join 之后 floor 仍是 0，不会提前丢
    expect(ledger.since(0, RUN)?.length).toBe(10)
    expect(ledger.stats().oldest).toBe(1)
  })

  it("所有人都确认过的才丢", () => {
    const ledger = createLedger(RUN, 100)
    ledger.join("桌面")
    ledger.join("手机")
    feed(ledger, 10)
    ledger.ack("桌面", 10)
    // 手机还停在 0，所以一条都不能丢
    expect(ledger.stats().oldest).toBe(1)
    ledger.ack("手机", 6)
    // 两边的最小值是 6，1..6 可以丢
    expect(ledger.stats().oldest).toBe(7)
    expect(ledger.since(6, RUN)?.map((s) => s.seq)).toEqual([7, 8, 9, 10])
  })

  it("**条数上限压过确认下限**——一个连着却不确认的客户端不能把内存拖垮", () => {
    const ledger = createLedger(RUN, 10)
    ledger.join("装死的")
    feed(ledger, 100)
    expect(ledger.stats().retained).toBe(10)
    // 代价明确：它掉队了，下次只能走全量。这是对的，不是降级
    expect(ledger.since(0, RUN)).toBeUndefined()
  })

  it("走了要摘掉，否则它会永久钉住下限", () => {
    const ledger = createLedger(RUN, 100)
    ledger.join("走了的")
    feed(ledger, 10)
    expect(ledger.stats().oldest).toBe(1)
    ledger.leave("走了的")
    // 没人 join 了，确认下限消失，只剩条数上限（100，没超）
    expect(ledger.stats().acked).toEqual({})
  })

  it("确认只前进不后退——乱序到达的 ack 不把下限拉回去", () => {
    const ledger = createLedger(RUN, 100)
    ledger.join("c")
    feed(ledger, 10)
    ledger.ack("c", 8)
    ledger.ack("c", 3)
    expect(ledger.stats().acked["c"]).toBe(8)
    expect(ledger.stats().oldest).toBe(9)
  })

  it("**确认一个还没发出去的号，按已发出的截断**——不能替未来承认", () => {
    const ledger = createLedger(RUN, 100)
    ledger.join("c")
    feed(ledger, 5)
    ledger.ack("c", 999)
    expect(ledger.stats().acked["c"]).toBe(5)
  })

  it("没 join 过的客户端报 ack 不算数——它不参与下限，也不该凭空进表", () => {
    const ledger = createLedger(RUN, 100)
    feed(ledger, 5)
    ledger.ack("野的", 5)
    expect(ledger.stats().acked).toEqual({})
    expect(ledger.stats().oldest).toBe(1)
  })

  it("**join 的初值是 0，不是 latest**——填 latest 等于替它承认了连接之前的全部", () => {
    const ledger = createLedger(RUN, 100)
    feed(ledger, 5)
    ledger.join("新来的")
    expect(ledger.stats().acked["新来的"]).toBe(0)
    expect(ledger.stats().oldest).toBe(1)
  })
})

describe("跨运行：代号对不上就一律全量", () => {
  it("**这是那条只挡住一半的判据留下的洞。** 宿主重启后已经发出的事件超过旧游标时，「报的号比我发过的还大」不成立，于是旧游标会被当成能续上——补回去的是新一轮的号段，客户端把两轮的状态拼在一起，且不报错", () => {
    const after = createLedger("run-b", 5000)
    feed(after, 3000)
    // 客户端手上是 run-a 的 50 号
    expect(after.since(50, "run-a")).toBeUndefined()
    // 没有代号判据的话，这一句会返回 51..3000（新一轮的号段）
    expect(after.since(50, "run-b")?.length).toBe(2950)
  })

  it("代号对得上、缺口也补得动，才给差量", () => {
    const ledger = createLedger("run-b")
    feed(ledger, 10)
    expect(ledger.since(7, "run-b")?.map((s) => s.seq)).toEqual([8, 9, 10])
    expect(ledger.since(7, "run-a")).toBeUndefined()
  })

  it("代号挂在账本上，外面读得到", () => {
    expect(createLedger("run-x").epoch).toBe("run-x")
  })
})
