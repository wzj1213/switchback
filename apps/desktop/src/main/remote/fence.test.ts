import { describe, expect, it } from "vitest"
import { assertTrustedAuthority, checkRequest, headersOf, isLoopbackHostname } from "./fence.js"

const ask = (headers: Record<string, string>, trusted: readonly string[] = []): boolean =>
  checkRequest(headersOf(headers), trusted, "zh-CN").ok

const why = (headers: Record<string, string>, trusted: readonly string[] = []): string => {
  const verdict = checkRequest(headersOf(headers), trusted, "zh-CN")
  return verdict.ok ? "" : verdict.reason
}

describe("回环判定", () => {
  const cases: readonly [string, boolean][] = [
    ["localhost", true],
    ["LOCALHOST", true],
    ["127.0.0.1", true],
    ["127.1.2.3", true],
    ["[::1]", true],
    ["::1", true],
    // **子域不算**：`foo.localhost` 由 DNS 决定指向哪儿，不是保证
    ["foo.localhost", false],
    ["localhost.evil.com", false],
    ["0.0.0.0", false],
    ["198.51.100.1", false],
    ["127.0.0.1.evil.com", false],
  ]
  for (const [host, expected] of cases) {
    it(`${host} → ${String(expected)}`, () => {
      expect(isLoopbackHostname(host)).toBe(expected)
    })
  }
})

describe("Host 闸（DNS 改绑防线）", () => {
  it("没有 Host 头一律拒", () => {
    expect(ask({})).toBe(false)
    expect(why({})).toContain("没有 Host")
  })

  it("回环放行", () => {
    expect(ask({ host: "127.0.0.1:17800" })).toBe(true)
    expect(ask({ host: "localhost:17800" })).toBe(true)
  })

  it("**陌生 Host 一律拒，哪怕请求确实来自本机**——那正是改绑的样子", () => {
    expect(ask({ host: "evil.com" })).toBe(false)
    expect(why({ host: "evil.com" })).toContain("trustedHosts")
  })

  it("配了才认，且端口写了就必须对上", () => {
    expect(ask({ host: "switchback.example.com:8443" }, ["switchback.example.com:8443"])).toBe(true)
    expect(ask({ host: "switchback.example.com:9999" }, ["switchback.example.com:8443"])).toBe(false)
  })

  it("配的时候不写端口 = 该主机名的任意端口（隧道那头端口可能是随机的）", () => {
    expect(ask({ host: "switchback.example.com:9999" }, ["switchback.example.com"])).toBe(true)
    expect(ask({ host: "switchback.example.com" }, ["switchback.example.com"])).toBe(true)
  })

  it("**后缀撞名不算命中**——`switchback.example.com.evil.com` 是能注册的域名", () => {
    for (const host of ["switchback.example.com.evil.com", "evilswitchback.example.com", "xswitchback.example.com"]) {
      expect(ask({ host }, ["switchback.example.com"])).toBe(false)
    }
  })

  it("大小写与多余的 :80 不决定信任", () => {
    expect(ask({ host: "SWITCHBACK.example.COM" }, ["switchback.example.com"])).toBe(true)
    expect(ask({ host: "switchback.example.com:80" }, ["switchback.example.com:80"])).toBe(true)
  })

  it("Host 解析不了就拒", () => {
    expect(ask({ host: "not a host" })).toBe(false)
  })
})

describe("跨站与 Origin", () => {
  it("明确标了 cross-site 的一律拒，不看 Origin", () => {
    expect(ask({ host: "127.0.0.1:17800", "sec-fetch-site": "cross-site" })).toBe(false)
  })

  it("same-origin / same-site 标记不影响放行", () => {
    expect(ask({ host: "127.0.0.1:17800", "sec-fetch-site": "same-origin" })).toBe(true)
  })

  it("带了 Origin 就必须正好是这个 authority", () => {
    expect(ask({ host: "127.0.0.1:17800", origin: "http://127.0.0.1:17800" })).toBe(true)
    expect(ask({ host: "127.0.0.1:17800", origin: "http://127.0.0.1:9999" })).toBe(false)
    expect(ask({ host: "127.0.0.1:17800", origin: "http://evil.com" })).toBe(false)
  })

  it("**没带 Origin 不算问题**——明文 HTTP 下浏览器的图片/导航读取本来就不带", () => {
    expect(ask({ host: "127.0.0.1:17800" })).toBe(true)
  })

  it('字面量 "null"（沙箱 iframe、file: 页面）是不透明来源，拒', () => {
    expect(ask({ host: "127.0.0.1:17800", origin: "null" })).toBe(false)
  })
})

describe("配置项校验：打错了要大声失败", () => {
  it("裸 authority 通过", () => {
    for (const entry of ["switchback.example.com", "switchback.example.com:8443", "198.51.100.9:8080"]) {
      expect(() => {
        assertTrustedAuthority(entry, "zh-CN")
      }).not.toThrow()
    }
  })

  const bad: readonly [string, string][] = [
    ["带路径会授权其中的主机名", "switchback.example.com/path"],
    ["带用户名同理", "user@switchback.example.com"],
    ["带 scheme", "https://switchback.example.com"],
    ["**悬空冒号会把「只信这个端口」放宽成任意端口**", "switchback.example.com:"],
    ["零填充端口", "switchback.example.com:08443"],
    ["未加括号的 IPv6", "::1"],
    ["空", ""],
    ["带空格", " switchback.example.com "],
  ]
  for (const [why_, entry] of bad) {
    it(`拒：${why_}（${JSON.stringify(entry)}）`, () => {
      expect(() => {
        assertTrustedAuthority(entry, "zh-CN")
      }).toThrow()
    })
  }
})
