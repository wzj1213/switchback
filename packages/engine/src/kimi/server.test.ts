import { describe, expect, it } from "vitest"
import { parseServerOutput } from "./server.js"

describe("Kimi Web 启动输出", () => {
  it("只接 loopback，并把 token 留在 WebSocket 子协议而不是 URL", () => {
    const endpoint = parseServerOutput("Local: http://127.0.0.1:56688/#token=abc_DEF-123\n")
    expect(endpoint).toEqual({
      baseUrl: "http://127.0.0.1:56688/api/v1",
      wsUrl: "ws://127.0.0.1:56688/api/v1/ws",
      protocol: "kimi-code.bearer.abc_DEF-123",
      token: "abc_DEF-123",
    })
    expect(endpoint?.baseUrl).not.toContain("abc_DEF-123")
    expect(endpoint?.wsUrl).not.toContain("abc_DEF-123")
  })

  it("网络地址和缺 token 的地址一律不接", () => {
    expect(parseServerOutput("http://198.51.100.3:8000/#token=x")).toBeUndefined()
    expect(parseServerOutput("http://127.0.0.1:8000/")).toBeUndefined()
  })

  it("不会把终端 ANSI 控制符吃进 token", () => {
    expect(parseServerOutput("http://127.0.0.1:8000/#token=safe-token\u001b[0m")?.token).toBe("safe-token")
  })
})
