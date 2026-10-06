import { describe, expect, it } from "vitest"
import { announce, checkForUpdate, isNewer } from "./update.js"

describe("版本比大小", () => {
  it("常规比较", () => {
    expect(isNewer("1.2.4", "1.2.3")).toBe(true)
    expect(isNewer("1.3.0", "1.2.9")).toBe(true)
    expect(isNewer("2.0.0", "1.9.9")).toBe(true)
    expect(isNewer("1.2.3", "1.2.3")).toBe(false)
    expect(isNewer("1.2.2", "1.2.3")).toBe(false)
  })

  it("**按数字比不按字符串比**——字符串里 \"10\" < \"9\"，这个 bug 要等到第十个小版本才暴露", () => {
    expect(isNewer("1.10.0", "1.9.0")).toBe(true)
    expect(isNewer("1.9.0", "1.10.0")).toBe(false)
    expect(isNewer("10.0.0", "9.0.0")).toBe(true)
  })

  it("**预发布比正式版小**——反过来的话，正式版发了还会提示用户回到 beta", () => {
    expect(isNewer("1.2.0-beta.1", "1.2.0")).toBe(false)
    expect(isNewer("1.2.0", "1.2.0-beta.1")).toBe(true)
    expect(isNewer("1.2.0-beta.2", "1.2.0-beta.1")).toBe(true)
  })

  it("前缀 v 和位数不齐都能吃下", () => {
    expect(isNewer("v1.2.4", "1.2.3")).toBe(true)
    expect(isNewer("2", "1.9.9")).toBe(true)
    expect(isNewer("1.2", "1.2.0")).toBe(false)
  })

  it("垃圾版本号当 0 处理，不抛", () => {
    expect(isNewer("乱写的", "0.0.0")).toBe(false)
    expect(isNewer("0.0.1", "乱写的")).toBe(true)
  })
})

const feed = "https://example.invalid/latest.json"

describe("查一次", () => {
  it("**没配 feed 就完全不动**——不发请求，一个字节都不出去", async () => {
    let called = false
    const out = await checkForUpdate({
      feed: "",
      current: "1.0.0",
      fetchText: () => {
        called = true
        return Promise.resolve("{}")
      },
    })
    expect(out).toEqual({ kind: "off" })
    expect(called).toBe(false)
  })

  it("有新版本就报出来，带下载地址", async () => {
    const out = await checkForUpdate({
      feed,
      current: "1.0.0",
      fetchText: () => Promise.resolve('{"version":"1.1.0","url":"https://x.example/switchback.dmg","notes":"修了几个 bug"}'),
    })
    expect(out).toEqual({
      kind: "newer",
      release: { version: "1.1.0", url: "https://x.example/switchback.dmg", notes: "修了几个 bug" },
    })
  })

  it("已是最新就说最新", async () => {
    const out = await checkForUpdate({
      feed,
      current: "2.0.0",
      fetchText: () => Promise.resolve('{"version":"1.1.0","url":"https://x.example/switchback.dmg"}'),
    })
    expect(out).toEqual({ kind: "current" })
  })

  it("**只认 https**——能被改成 http 或 file 的更新地址就是一条把人引去任意地方的路", async () => {
    for (const url of ["http://x.example/o.dmg", "file:///tmp/evil.dmg", "javascript:alert(1)"]) {
      const out = await checkForUpdate({
        feed,
        current: "1.0.0",
        fetchText: () => Promise.resolve(JSON.stringify({ version: "9.9.9", url })),
      })
      expect(out.kind).toBe("failed")
    }
  })

  it("**网络挂了只返回 failed，绝不抛**——背景动作不该掀翻主进程", async () => {
    const out = await checkForUpdate({
      feed,
      current: "1.0.0",
      fetchText: () => Promise.reject(new Error("getaddrinfo ENOTFOUND")),
    })
    expect(out).toMatchObject({ kind: "failed" })
    expect(out.kind === "failed" ? out.detail : "").toContain("ENOTFOUND")
  })

  it("返回的不是 JSON 也只是 failed", async () => {
    const out = await checkForUpdate({ feed, current: "1.0.0", fetchText: () => Promise.resolve("<html>404</html>") })
    expect(out.kind).toBe("failed")
  })

  it("缺字段的 JSON 说得出缺什么", async () => {
    const out = await checkForUpdate({ feed, current: "1.0.0", fetchText: () => Promise.resolve('{"version":"9.9.9"}') })
    expect(out.kind === "failed" ? out.detail : "").toContain("version 和 https 的 url")
  })
})

interface Asked {
  message: string
  detail?: string
  buttons: string[]
}

function ui(choice = 0): {
  asked: Asked[]
  opened: string[]
  logged: string[]
  ask: (o: Asked) => Promise<number>
  open: (u: string) => void
  log: (level: "info" | "warn", message: string) => void
} {
  const asked: Asked[] = []
  const opened: string[] = []
  const logged: string[] = []
  return {
    asked,
    opened,
    logged,
    ask: (o) => {
      asked.push(o)
      return Promise.resolve(choice)
    },
    open: (u) => opened.push(u),
    log: (level, message) => logged.push(`${level} ${message}`),
  }
}

const RELEASE = { version: "9.9.9", url: "https://x.example/switchback.dmg", notes: "修了几个 bug" }

describe("怎么告诉用户", () => {
  it("有新版本，点「去下载」就用系统浏览器打开——**不在应用里下载**", async () => {
    const box = ui(0)
    await announce({ kind: "newer", release: RELEASE }, box, false)
    expect(box.opened).toEqual(["https://x.example/switchback.dmg"])
  })

  it("点「以后再说」什么都不做", async () => {
    const box = ui(1)
    await announce({ kind: "newer", release: RELEASE }, box, false)
    expect(box.opened).toEqual([])
  })

  it("**要说清楚为什么得手动装**——不说的话用户会以为按钮坏了", async () => {
    const box = ui(1)
    await announce({ kind: "newer", release: RELEASE }, box, true)
    expect(box.asked[0]?.detail).toContain("修了几个 bug")
    expect(box.asked[0]?.detail).toContain("不自动安装")
  })

  it("**背景检查报「已是最新」是纯噪声**，只有手动点才回答", async () => {
    const quiet = ui()
    await announce({ kind: "current" }, quiet, false)
    expect(quiet.asked).toEqual([])

    const asked = ui()
    await announce({ kind: "current" }, asked, true)
    expect(asked.asked[0]?.message).toContain("最新")
  })

  it("失败一律记日志；只有手动点才弹窗——背景动作不该拿网络抖动打断人", async () => {
    const quiet = ui()
    await announce({ kind: "failed", detail: "ENOTFOUND" }, quiet, false)
    expect(quiet.asked).toEqual([])
    expect(quiet.logged[0]).toContain("ENOTFOUND")

    const asked = ui()
    await announce({ kind: "failed", detail: "ENOTFOUND" }, asked, true)
    expect(asked.asked).toHaveLength(1)
  })

  it("没配 feed 时连日志都不写——这个功能整个不存在", async () => {
    const box = ui()
    await announce({ kind: "off" }, box, true)
    expect(box.asked).toEqual([])
    expect(box.logged).toEqual([])
  })
})
