import { describe, expect, it } from "vitest"
import type { Handoff } from "./build.js"
import { compareRuns } from "./compare.js"

const run = (over: Partial<Handoff>): Handoff => ({
  goal: "把 add 补上 JSDoc",
  asks: [],
  changed: [],
  commands: [],
  decisions: [],
  open: [],
  last: undefined,
  ...over,
})

describe("对比两次跑", () => {
  it("**只有一边动过的文件排在最前**——那是最需要人看一眼的一行", () => {
    const a = run({
      changed: [
        { path: "/w/共同.ts", added: 3, removed: 1 },
        { path: "/w/只有A.ts", added: 9, removed: 0 },
      ],
    })
    const b = run({ changed: [{ path: "/w/共同.ts", added: 3, removed: 1 }] })
    const out = compareRuns(a, b)
    expect(out.files[0]?.path).toBe("/w/只有A.ts")
    expect(out.files[0]?.side).toBe("a")
    expect(out.onlyOneSide).toBe(1)
  })

  it("两边都动了但行数不同 → differs", () => {
    const a = run({ changed: [{ path: "/w/x.ts", added: 3, removed: 0 }] })
    const b = run({ changed: [{ path: "/w/x.ts", added: 30, removed: 12 }] })
    expect(compareRuns(a, b).files[0]).toMatchObject({ side: "both", differs: true })
  })

  it("**行数相同不等于内容相同**，所以只标 differs=false，不说「一样」", () => {
    const same = { path: "/w/x.ts", added: 3, removed: 1 }
    const out = compareRuns(run({ changed: [same] }), run({ changed: [same] }))
    expect(out.files[0]).toMatchObject({ side: "both", differs: false })
    expect(out.onlyOneSide).toBe(0)
  })

  it("命令按去重后的并集比，只有一边跑过的排前面", () => {
    const a = run({ commands: ["pnpm test", "git status"] })
    const b = run({ commands: ["pnpm test"] })
    const out = compareRuns(a, b)
    expect(out.commands[0]).toEqual({ command: "git status", side: "a" })
    expect(out.commands[1]).toEqual({ command: "pnpm test", side: "both" })
  })

  it("剩下没做的各报各的——**两边都空不代表两边都对**", () => {
    const out = compareRuns(run({ open: ["补测试"] }), run({ open: [] }))
    expect(out.open).toEqual({ a: ["补测试"], b: [] })
  })

  it("最后那句话并排给出来，读它比读任何统计都快", () => {
    const out = compareRuns(run({ last: "改好了" }), run({ last: "我没找到那个函数" }))
    expect(out.last).toEqual({ a: "改好了", b: "我没找到那个函数" })
  })

  it("两边都没动过东西时不报错，也不假装有差异", () => {
    const out = compareRuns(run({}), run({}))
    expect(out).toMatchObject({ files: [], commands: [], onlyOneSide: 0 })
  })
})
