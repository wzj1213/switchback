import { describe, expect, it } from "vitest"
import type { Item } from "@omni/protocol"
import { planErrors, retryTarget, type SoftState } from "./error-plan.js"

const said = (id: string, turnId: string, at: number): Item => ({ id, turnId, at, kind: "agent_message", text: "嗯", complete: true })
const soft = (id: string, turnId: string, at: number): Item => ({ id, turnId, at, kind: "error", message: "Reconnecting... 3/5", fatal: false })
const fatal = (id: string, turnId: string, at: number): Item => ({ id, turnId, at, kind: "error", message: "stream disconnected", fatal: true })
const asked = (turnId: string, text = "改掉它", origin?: "handoff"): Item => ({
  id: `u-${turnId}`, turnId, at: 0, kind: "user_message", text, ...(origin === undefined ? {} : { origin }),
})

describe("可恢复报错的三种样子", () => {
  const cases: readonly { name: string; items: readonly Item[]; running?: string; want: Record<string, SoftState> }[] = [
    { name: "还在跑、是最新的动静：正在重试", items: [said("a", "t1", 1), soft("r", "t1", 2)], running: "t1", want: { r: "live" } },
    { name: "后面接着有了回答：过去了", items: [soft("r", "t1", 1), said("a", "t1", 2)], running: "t1", want: { r: "past" } },
    { name: "原地更新到更晚的时刻：又在重试", items: [soft("r", "t1", 5), said("a", "t1", 2)], running: "t1", want: { r: "live" } },
    { name: "这一轮收工了：过去了", items: [said("a", "t1", 1), soft("r", "t1", 2)], want: { r: "past" } },
    { name: "后面跟着终态报错：并进那张卡", items: [soft("r", "t1", 1), fatal("f", "t1", 2)], want: { r: "absorbed" } },
    { name: "别的轮的终态报错不吞它", items: [soft("r", "t1", 1), fatal("f", "t2", 2)], want: { r: "past" } },
  ]
  for (const one of cases) {
    it(one.name, () => {
      expect(Object.fromEntries(planErrors(one.items, one.running).soft)).toEqual(one.want)
    })
  }

  it("终态报错卡记下它吞掉的那几条", () => {
    const plan = planErrors([soft("r1", "t1", 1), soft("r2", "t1", 2), fatal("f", "t1", 3)], undefined)
    expect(plan.prior.get("f")?.map((item) => item.id)).toEqual(["r1", "r2"])
  })
})

describe("再试一次重发哪一句", () => {
  const cases: readonly { name: string; items: readonly Item[]; want: ReturnType<typeof retryTarget> }[] = [
    { name: "最后一轮失败收场：重发那一轮你说的话", items: [asked("t1"), fatal("f", "t1", 2)], want: { errorId: "f", text: "改掉它" } },
    { name: "失败的不是最后一轮：不给", items: [asked("t1"), fatal("f", "t1", 2), asked("t2"), said("a", "t2", 3)], want: undefined },
    { name: "最后一轮好好的：不给", items: [asked("t1"), said("a", "t1", 2)], want: undefined },
    { name: "那一句是接力带过来的、不是你说的：不给", items: [asked("t1", "改掉它", "handoff"), fatal("f", "t1", 2)], want: undefined },
    { name: "一轮里报了两次：挂在最后那张上", items: [asked("t1"), fatal("f1", "t1", 2), fatal("f2", "t1", 3)], want: { errorId: "f2", text: "改掉它" } },
  ]
  for (const one of cases) it(one.name, () => expect(retryTarget(one.items)).toEqual(one.want))
})
