import { describe, expect, it } from "vitest"
import { findInIndex } from "./kimi.js"

/**
 * 索引是**别的进程在追加写的**，所以这里测的重点不是「顺利时能查到」，
 * 而是「文件被写坏了一半时不会连累整份索引」。
 */
describe("kimi 会话索引", () => {
  const row = (id: string, dir: string): string => JSON.stringify({ sessionId: id, sessionDir: dir, workDir: "/w" })

  it("按 sessionId 查目录", () => {
    const text = [row("session_a", "/s/a"), row("session_b", "/s/b")].join("\n")
    expect(findInIndex(text, "session_b")).toBe("/s/b")
  })

  it("查不到给 undefined，不是猜一个", () => {
    expect(findInIndex(row("session_a", "/s/a"), "session_zzz")).toBeUndefined()
  })

  // 追加写到一半的一行完全可能被读到。为一行坏数据丢掉整份索引不划算
  it("坏行跳过，不影响别的行", () => {
    const text = ["{这不是 json", row("session_a", "/s/a"), ""].join("\n")
    expect(findInIndex(text, "session_a")).toBe("/s/a")
  })

  // 重复时后写的那条才是现在有效的
  it("同一个 id 有多条时取最后一条", () => {
    const text = [row("session_a", "/旧"), row("session_a", "/新")].join("\n")
    expect(findInIndex(text, "session_a")).toBe("/新")
  })

  it("缺字段的行不算数", () => {
    const text = [JSON.stringify({ sessionId: "session_a" }), row("session_a", "/s/a")].join("\n")
    expect(findInIndex(text, "session_a")).toBe("/s/a")
  })
})
