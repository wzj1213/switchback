import { describe, expect, it } from "vitest"
import type { Thread, ThreadStatus } from "@switchback/protocol"
import { busy, createAwake, type Blocker } from "./awake.js"
import { quitBlurb } from "./quit.js"

const thread = (id: string, status: ThreadStatus): Thread => ({
  id,
  engine: "codex",
  cwd: "/tmp/w",
  title: id,
  status,
  createdAt: 0,
  updatedAt: 0,
  trust: "read-only",
  engineHistory: [],
})

const questioning = (): Thread => ({
  ...thread("q", "idle"),
  pendingQuestions: [{ id: "q1", questions: [{ id: "one", question: "选？", options: [] }] }],
})

/**
 * 「现在还有没有活在跑」是两件事共用的判据：挡不挡待机、⌘Q 问不问。
 * 判错的代价不对称——**多算一次只是多问一句，少算一次是十分钟的活没了**。
 */
describe("busy", () => {
  it("在跑的算", () => {
    expect(busy([thread("a", "running")])).toBe(true)
  })

  it("等审批的也算：那时引擎进程还在，睡过去照样断", () => {
    expect(busy([thread("a", "waiting_approval")])).toBe(true)
  })

  it("状态虽空闲但还有原生问题在等，也不能让机器睡掉或静默退出", () => {
    expect(busy([questioning()])).toBe(true)
  })

  it("闲着、刚起、挂了的都不算——不然断言永远放不开", () => {
    for (const status of ["idle", "starting", "failed"] as const) {
      expect(busy([thread("a", status), thread("b", status)])).toBe(false)
    }
  })

  it("一条都没有的时候是 false，不是抛", () => {
    expect(busy([])).toBe(false)
  })
})

/**
 * 框里那句话要说清楚**有几条、以及退出会把它们怎么样**。
 * 「确定要退出吗？」给不出判断依据，人只能凭手感按——那和不问差不多。
 */
describe("quitBlurb", () => {
  it("两种都有的时候分开数", () => {
    const text = quitBlurb([
      thread("a", "running"),
      thread("b", "running"),
      thread("c", "waiting_approval"),
      thread("d", "idle"),
    ])
    expect(text).toContain("2 条正在跑")
    expect(text).toContain("1 条等着你批")
  })

  it("只有一种的时候不留下空的另一半", () => {
    const text = quitBlurb([thread("a", "running")])
    expect(text).toContain("1 条正在跑")
    expect(text).not.toContain("等着你批")
    expect(text.startsWith("、")).toBe(false)
  })

  it("说出后果，不只是报数", () => {
    expect(quitBlurb([thread("a", "running")])).toContain("结束")
  })

  it("原生问题单独计数，让人知道退出会丢掉什么", () => {
    expect(quitBlurb([questioning()])).toContain("1 组等着你回答")
  })
})

/**
 * 电源断言的两件事：**别攥着两个**，**安静下来一定放开**。
 * 两件都错得无声——只是机器再也不睡，发现的时候已经是几天之后。
 */
function fakeBlocker(): Blocker & { live: () => number[]; starts: number } {
  const state = { ids: [] as number[], next: 1, starts: 0 }
  return {
    start: () => {
      state.starts += 1
      const id = state.next++
      state.ids.push(id)
      return id
    },
    isStarted: (id) => state.ids.includes(id),
    stop: (id) => {
      state.ids = state.ids.filter((x) => x !== id)
    },
    live: () => state.ids,
    get starts() {
      return state.starts
    },
  }
}

describe("createAwake", () => {
  it("一轮几百条事件也只攥一个", () => {
    const blocker = fakeBlocker()
    const awake = createAwake(blocker)
    for (let i = 0; i < 200; i += 1) awake.sync([thread("a", "running")])
    expect(blocker.starts).toBe(1)
    expect(blocker.live()).toHaveLength(1)
  })

  it("安静下来就放开", () => {
    const blocker = fakeBlocker()
    const awake = createAwake(blocker)
    awake.sync([thread("a", "running")])
    awake.sync([thread("a", "idle")])
    expect(blocker.live()).toEqual([])
  })

  it("再忙起来能重新攥一个——放开之后不能就此失灵", () => {
    const blocker = fakeBlocker()
    const awake = createAwake(blocker)
    awake.sync([thread("a", "running")])
    awake.sync([thread("a", "idle")])
    awake.sync([thread("a", "running")])
    expect(blocker.live()).toHaveLength(1)
    expect(blocker.starts).toBe(2)
  })

  it("本来就闲着的时候 release 不炸", () => {
    const blocker = fakeBlocker()
    const awake = createAwake(blocker)
    awake.release()
    awake.release()
    expect(blocker.live()).toEqual([])
  })

  it("退出前 release 放得掉", () => {
    const blocker = fakeBlocker()
    const awake = createAwake(blocker)
    awake.sync([thread("a", "waiting_approval")])
    awake.release()
    expect(blocker.live()).toEqual([])
  })
})
