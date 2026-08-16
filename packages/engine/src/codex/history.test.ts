import { describe, expect, it } from "vitest"
import { toAccount, toEngineThreads } from "./catalog.js"

/**
 * 引擎自己存的会话 → omni 的形状。
 *
 * 这里钉的两件事都是拿真实响应换来的：时间戳是**秒**（和 rateLimits 的
 * resetsAt 同一个坑），以及缺句柄/缺 cwd 的行绝不能列出来。
 */
describe("引擎会话清单", () => {
  const raw = (rows: unknown[]): unknown => ({ data: rows })

  it("**时间戳是秒**，要乘 1000——rateLimits 那次已经在同一个坑里栽过一回", () => {
    const [t] = toEngineThreads(raw([{ id: "a", cwd: "/w", updatedAt: 1786900430 }]))
    expect(t?.updatedAt).toBe(1786900430 * 1000)
  })

  it("没有句柄的不给列——列出来点了就报错，比看不见更糟", () => {
    expect(toEngineThreads(raw([{ cwd: "/w", updatedAt: 1 }]))).toEqual([])
  })

  it("**没有 cwd 的也不给列**：工作区边界是所有写范围判定的真源，猜不得", () => {
    expect(toEngineThreads(raw([{ id: "a", updatedAt: 1 }]))).toEqual([])
  })

  it("用户起过名字就用名字", () => {
    const [t] = toEngineThreads(raw([{ id: "a", cwd: "/w", name: "修分页那个", preview: "帮我看看…" }]))
    expect(t?.title).toBe("修分页那个")
  })

  it("没名字就取 preview 的**第一行**——它是整段提问，常带换行和代码块", () => {
    const [t] = toEngineThreads(raw([{ id: "a", cwd: "/w", preview: "跑一下测试\n```js\nfoo()\n```" }]))
    expect(t?.title).toBe("跑一下测试")
  })

  it("太长的截断，不让一行标题吃掉整个侧栏", () => {
    const long = "拖".repeat(200)
    const [t] = toEngineThreads(raw([{ id: "a", cwd: "/w", preview: long }]))
    expect((t?.title ?? "").length).toBeLessThan(70)
  })

  it("什么都没有时给个占位，不给空字符串（那一行会变成一块空白）", () => {
    const [t] = toEngineThreads(raw([{ id: "a", cwd: "/w" }]))
    expect(t?.title).not.toBe("")
  })

  it("有上限：侧栏里的一段不该是无底洞", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `t${String(i)}`, cwd: "/w" }))
    expect(toEngineThreads(raw(many)).length).toBeLessThanOrEqual(40)
  })

  it("认不出的形状给空数组，不抛", () => {
    expect(toEngineThreads(undefined)).toEqual([])
    expect(toEngineThreads({ nope: 1 })).toEqual([])
  })
})

describe("账号", () => {
  it("登录时给邮箱和套餐（实测形状）", () => {
    expect(toAccount({ account: { type: "chatgpt", email: "a@b.com", planType: "prolite" } })).toEqual({
      label: "a@b.com",
      plan: "prolite",
    })
  })

  it("**登出时 account 是 null**（拿空 CODEX_HOME 实测过），给 undefined", () => {
    expect(toAccount({ account: null })).toBeUndefined()
  })

  it("没有邮箱就当没有账号——一行只有套餐名的账号行说不清是谁", () => {
    expect(toAccount({ account: { planType: "prolite" } })).toBeUndefined()
  })
})
