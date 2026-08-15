import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ENGINES_FILE, ensureEngineFile, readEngineFile, registerAcpEngines } from "./engines.js"
import type { Logger } from "./log.js"

function dirWith(content?: string): { dir: string; log: Logger; logged: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "omni-engines-"))
  if (content !== undefined) writeFileSync(join(dir, ENGINES_FILE), content, "utf8")
  const logged: string[] = []
  return {
    dir,
    logged,
    log: { file: join(dir, "x.log"), write: (level, scope, message) => logged.push(`${level} ${scope} ${message}`) },
  }
}

describe("读引擎注册表", () => {
  it("没有这个文件就是没有第三方引擎——不是错误", () => {
    const { dir, log, logged } = dirWith()
    expect(readEngineFile(dir, log)).toEqual({})
    expect(logged).toEqual([])
  })

  it("**JSON 写坏了只丢第三方引擎，不能掐掉应用**——这是用户手写的文件，写坏是常态", () => {
    const { dir, log, logged } = dirWith("{ 这不是 JSON")
    expect(readEngineFile(dir, log)).toEqual({})
    expect(logged[0]).toContain("解析失败")
  })

  it("下划线开头的键是说明文字，跳过", () => {
    const { dir, log } = dirWith(
      JSON.stringify({ _说明: ["随便写点什么"], zcode: { label: "ZCode", command: "zcode-acp" } }),
    )
    expect(Object.keys(readEngineFile(dir, log))).toEqual(["zcode"])
  })

  it("没有 command 的条目跳过——半残地注册出来，用户点了才发现是空的", () => {
    const { dir, log } = dirWith(JSON.stringify({ bad: { label: "缺命令" }, ok: { command: "x" } }))
    expect(Object.keys(readEngineFile(dir, log))).toEqual(["ok"])
  })

  it("label 缺失时用 id 顶上，不显示一个空白项", () => {
    const { dir, log } = dirWith(JSON.stringify({ kimi: { command: "kimi-acp" } }))
    expect(readEngineFile(dir, log)["kimi"]?.label).toBe("kimi")
  })

  it("args 里的非字符串滤掉——JSON 里塞个数字进去不该变成 spawn 参数", () => {
    const { dir, log } = dirWith(JSON.stringify({ a: { command: "x", args: ["--acp", 7, null] } }))
    expect(readEngineFile(dir, log)["a"]?.args).toEqual(["--acp"])
  })
})

describe("写样板", () => {
  it("文件不存在就写一份，写出来的是合法 JSON", () => {
    const { dir } = dirWith()
    const path = ensureEngineFile(dir)
    expect(() => JSON.parse(readFileSync(path, "utf8")) as unknown).not.toThrow()
  })

  it("**已存在绝不覆盖**——那是用户的配置", () => {
    const { dir } = dirWith('{"mine":{"command":"my-acp"}}')
    ensureEngineFile(dir)
    expect(readFileSync(join(dir, ENGINES_FILE), "utf8")).toBe('{"mine":{"command":"my-acp"}}')
  })

  it("样板里的示例条目本身是可解析的，但它只是样板", () => {
    const { dir, log } = dirWith()
    ensureEngineFile(dir)
    expect(Object.keys(readEngineFile(dir, log))).toEqual(["example"])
  })
})

describe("注册成驱动", () => {
  it("**id 统一加 acp: 前缀**——事件流里一眼看得出走的哪条协议，也防止覆盖内置引擎", () => {
    const { drivers, labels } = registerAcpEngines({
      zcode: { label: "ZCode", command: "zcode-acp" },
      codex: { label: "冒名顶替", command: "fake" },
    })
    expect(Object.keys(drivers).sort()).toEqual(["acp:codex", "acp:zcode"])
    expect(labels["acp:zcode"]).toBe("ZCode")
    // 内置的 codex 不会被同名条目顶掉
    expect(drivers).not.toHaveProperty("codex")
  })

  it("空表就空表，界面上只剩内置的两家——诚实", () => {
    expect(registerAcpEngines({}).drivers).toEqual({})
  })
})
