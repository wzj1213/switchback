import { describe, expect, it } from "vitest"
import { scrub } from "./log.js"

describe("scrub", () => {
  it("多行压成一行——日志一行一条，不然轮转和 tail 都不好使", () => {
    expect(scrub("第一行\n第二行\t第三行")).toBe("第一行 第二行 第三行")
  })

  it("**超长内容截断并标明**——引擎的 stderr 一次能吐几百 KB，不截会把整份日志冲掉", () => {
    const out = scrub("x".repeat(5000))
    expect(out.length).toBeLessThan(2100)
    expect(out).toContain("已截断")
  })

  it("正常长度的消息原样保留，不加噪声", () => {
    expect(scrub("找不到可执行文件 codex")).toBe("找不到可执行文件 codex")
  })

  it("首尾空白去掉", () => {
    expect(scrub("  有内容  ")).toBe("有内容")
  })
})

describe("scrub 抹凭据", () => {
  it("**长文本开头的密钥不能靠截断解决**——第一版就是这么漏的", () => {
    const out = scrub(`const API_KEY = "sk-live-abcdefghijklmn"\n${"x".repeat(5000)}`)
    expect(out).not.toContain("sk-live-abcdefghijklmn")
    expect(out).toContain("已抹去")
  })

  it("认得几种常见前缀", () => {
    expect(scrub("ghp_abcdefghijklmnopqrstuvwxyz0123")).toContain("已抹去")
    expect(scrub("AKIAIOSFODNN7EXAMPLE")).toContain("已抹去")
    expect(scrub("xoxb-1234567890-abcdefghij")).toContain("已抹去")
  })

  it("认得 Authorization 头与 key=值", () => {
    expect(scrub("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9abcdefgh")).not.toContain("eyJhbGci")
    expect(scrub("api_key=hunter2secret")).not.toContain("hunter2secret")
  })

  it("普通错误消息不会被误伤", () => {
    const msg = "找不到可执行文件 codex，请确认它在 PATH 上"
    expect(scrub(msg)).toBe(msg)
  })

  it("路径不会被当成凭据抹掉——那是排查时最有用的信息", () => {
    const msg = "spawn /Applications/Switchback.app/Contents/Resources/app.asar/node_modules/x ENOTDIR"
    expect(scrub(msg)).toBe(msg)
  })
})
