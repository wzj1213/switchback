import { describe, expect, it } from "vitest"
import { canTitle, nameSession } from "./title.js"

const queryWith = (fn: unknown): unknown => ({ generateSessionTitle: fn })

describe("让引擎自己给会话起名", () => {
  it("探的是手上这个 query 对象，不是版本号", () => {
    expect(canTitle(queryWith(() => Promise.resolve("x")))).toBe(true)
    expect(canTitle({})).toBe(false)
    expect(canTitle(undefined)).toBe(false)
    // 有这个字段但不是函数，同样算没有
    expect(canTitle(queryWith("generate"))).toBe(false)
  })

  it("把第一句话原样递过去——不是 omni 写的提示词", async () => {
    const seen: unknown[] = []
    const query = queryWith((...args: unknown[]) => {
      seen.push(args)
      return Promise.resolve("排查登录 500")
    })
    expect(await nameSession(query, "  帮我看看这个 500  ")).toBe("排查登录 500")
    // 只传 description；**`persist` 不传**，写不写进它自己的档案由它决定
    expect(seen).toEqual([["帮我看看这个 500"]])
  })

  it("起不出来就返回 undefined——不编一个，也不拿第一句话截一段冒充", async () => {
    const cases: readonly unknown[] = [
      () => Promise.resolve(""),
      () => Promise.resolve("   "),
      () => Promise.resolve(undefined),
      () => Promise.resolve(42),
      () => Promise.reject(new Error("控制请求超时")),
    ]
    for (const fn of cases) expect(await nameSession(queryWith(fn), "第一句话")).toBeUndefined()
    // 不支持这条控制请求的引擎，以及空的第一句话
    expect(await nameSession({}, "第一句话")).toBeUndefined()
    expect(await nameSession(queryWith(() => Promise.resolve("名字")), "   ")).toBeUndefined()
  })
})
