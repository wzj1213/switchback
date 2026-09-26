import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  acpShapes,
  ENGINES_FILE,
  mergeAcpEngines,
  readEngineFile,
  registerAcpEngines,
  type EngineEntry,
} from "./engines.js"
import { addEngineEntry, engineNameOf, ensureEngineFile, removeEngineEntry, replaceEngineEntry } from "./engines-file.js"
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

  it("只认布尔 true 的扩展能力，字符串和数字不能放出假按钮", () => {
    const { dir, log } = dirWith(JSON.stringify({
      good: { command: "vendor-acp", compact: true, steer: true },
      bad: { command: "other", compact: "true", steer: 1 },
    }))
    expect(readEngineFile(dir, log)["good"]).toMatchObject({ compact: true, steer: true })
    expect(readEngineFile(dir, log)["bad"]).not.toHaveProperty("compact")
    expect(readEngineFile(dir, log)["bad"]).not.toHaveProperty("steer")
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

  it("空表就空表，不凭空注册第三方引擎", () => {
    expect(registerAcpEngines({}).drivers).toEqual({})
  })
})

/**
 * 运行期把 `engines.json` 里新增的那几家接进来。
 *
 * **这条守的是「只加，不改也不删」。** 改和删都会换掉或抽走一个正在被使用的
 * 驱动实例——活着的会话握着它的引用，底下还挂着引擎进程。为了省一次重启
 * 去冒「会话半路换了驱动」的险不划算，而那种故障非常难查。
 */
describe("运行期合并 engines.json", () => {
  const entry = (command: string): EngineEntry => ({ label: `L-${command}`, command })

  it("新增的接进来、立刻可用；已有的原样不动", () => {
    const file = { a: entry("a") }
    const target = registerAcpEngines(file)
    const known = acpShapes(file)
    const first = target.drivers["acp:a"]

    const done = mergeAcpEngines(target, known, { a: entry("a"), b: entry("b") })

    expect(done).toEqual({ added: ["acp:b"], replaced: [], removed: [], needsRestart: [] })
    expect(target.labels["acp:b"]).toBe("L-b")
    // **同一个实例**：没被顺手重建，正在用它的会话不受影响
    expect(target.drivers["acp:a"]).toBe(first)
  })

  it("改过的、**有会话在用**：不换驱动，只报「要重启」", () => {
    const file = { a: entry("a") }
    const target = registerAcpEngines(file)
    const known = acpShapes(file)
    const first = target.drivers["acp:a"]

    const done = mergeAcpEngines(target, known, { a: entry("改成了别的") }, () => true)

    expect(done).toEqual({ added: [], replaced: [], removed: [], needsRestart: ["acp:a"] })
    expect(target.drivers["acp:a"]).toBe(first)
  })

  it("从文件里删掉的、**有会话在用**：不抽走驱动，同样只报「要重启」", () => {
    const file = { a: entry("a") }
    const target = registerAcpEngines(file)
    const known = acpShapes(file)

    const done = mergeAcpEngines(target, known, {}, () => true)

    expect(done).toEqual({ added: [], replaced: [], removed: [], needsRestart: ["acp:a"] })
    expect(target.drivers["acp:a"]).toBeDefined()
  })

  it("不说谁在用就当都在用——退回最保守的老路", () => {
    const file = { a: entry("a") }
    const target = registerAcpEngines(file)
    const done = mergeAcpEngines(target, acpShapes(file), { a: entry("b") })
    expect(done.needsRestart).toEqual(["acp:a"])
  })

  it("没人在用：改过的当场换成新配置，删掉的当场摘掉（名字留给历史会话）", () => {
    const file = { a: entry("a"), gone: entry("gone") }
    const target = registerAcpEngines(file)
    const known = acpShapes(file)
    const first = target.drivers["acp:a"]

    const done = mergeAcpEngines(target, known, { a: entry("a2") }, () => false)

    expect(done).toEqual({ added: [], replaced: ["acp:a"], removed: ["acp:gone"], needsRestart: [] })
    expect(target.drivers["acp:a"]).not.toBe(first)
    expect(target.labels["acp:a"]).toBe("L-a2")
    expect(target.drivers["acp:gone"]).toBeUndefined()
    expect(target.labels["acp:gone"]).toBe("L-gone")
    // 换过之后再读同一份就不再报事
    expect(mergeAcpEngines(target, known, { a: entry("a2") }, () => false)).toEqual({
      added: [], replaced: [], removed: [], needsRestart: [],
    })
  })

  it("一个字没改就什么都不报——重复点「重新探测」不该每次都说有事", () => {
    const file = { a: entry("a") }
    const target = registerAcpEngines(file)
    const known = acpShapes(file)
    const quiet = { added: [], replaced: [], removed: [], needsRestart: [] }

    expect(mergeAcpEngines(target, known, file)).toEqual(quiet)
    expect(mergeAcpEngines(target, known, file)).toEqual(quiet)
  })

  it("注册表来源三样齐全才认，缺一样当手接的", () => {
    const { dir, log } = dirWith(JSON.stringify({
      a: { command: "npx", registry: { id: "gemini", version: "0.61.0", kind: "npx" } },
      b: { command: "npx", registry: { id: "gemini", version: "0.61.0", kind: "pip" } },
      c: { command: "npx", registry: { id: "gemini" } },
    }))
    const file = readEngineFile(dir, log)
    expect(file["a"]?.registry).toEqual({ id: "gemini", version: "0.61.0", kind: "npx" })
    expect(file["b"]?.registry).toBeUndefined()
    expect(file["c"]?.registry).toBeUndefined()
  })
})

describe("从命令名推 id", () => {
  const cases: readonly { raw: string; want: string | undefined; why: string }[] = [
    { raw: "zcode-acp-server", want: "zcode-acp-server", why: "本来就合法就原样" },
    { raw: "/opt/homebrew/bin/codex-acp", want: "codex-acp", why: "绝对路径只取文件名" },
    { raw: "ZCode", want: "zcode", why: "统一小写" },
    { raw: "My Agent 2", want: "my-agent-2", why: "空格并成连字符" },
    { raw: "agent.exe", want: "agent", why: "去掉可执行后缀" },
    { raw: "  ", want: undefined, why: "推不出来就说推不出来，别硬凑一个空 id" },
    { raw: "***", want: undefined, why: "同上" },
    { raw: "_说明", want: undefined, why: "下划线开头是注释键，不能占用" },
  ]
  it.each(cases)("$raw → $want（$why）", ({ raw, want }) => {
    expect(engineNameOf(raw)).toBe(want)
  })
})

/**
 * 往注册表里加一条。**这几条守的都是同一件事：那是用户手写的文件。**
 */
describe("写进 engines.json", () => {
  const dir = (): string => mkdtempSync(join(tmpdir(), "omni-add-"))
  const log: Logger = { file: "/tmp/omni-engines-add.log", write: () => undefined }

  it("加完能读回来，`acp:` 前缀由这一层给", () => {
    const at = dir()
    expect(addEngineEntry(at, "zcode", { label: "ZCode", command: "zcode-acp", args: ["--stdio"] })).toEqual({
      ok: true,
      id: "acp:zcode",
    })
    expect(readEngineFile(at, log)["zcode"]).toEqual({
      label: "ZCode",
      command: "zcode-acp",
      args: ["--stdio"],
    })
  })

  it("**`_说明` 和不认识的字段不能被写没了**——那是用户的文件，不是我们的数据结构", () => {
    const at = dir()
    writeFileSync(
      join(at, ENGINES_FILE),
      JSON.stringify({ _说明: ["别删我"], old: { label: "旧", command: "x", 我们还不认识的字段: 1 } }),
      "utf8",
    )
    expect(addEngineEntry(at, "新的", { label: "新", command: "y" }).ok).toBe(true)
    const raw = JSON.parse(readFileSync(join(at, ENGINES_FILE), "utf8")) as Record<string, unknown>
    expect(raw["_说明"]).toEqual(["别删我"])
    expect(raw["old"]).toEqual({ label: "旧", command: "x", 我们还不认识的字段: 1 })
  })

  it("重名不覆盖——那可能是一条正在被会话用着的配置", () => {
    const at = dir()
    addEngineEntry(at, "zcode", { label: "ZCode", command: "a" })
    const again = addEngineEntry(at, "zcode", { label: "别的", command: "b" })
    expect(again.ok).toBe(false)
    expect(again.error).toContain("已经有一条")
    expect(readEngineFile(at, log)["zcode"]?.command).toBe("a")
  })

  it("文件坏掉时**不写**：宁可让人自己修，也不能拿新的盖掉他手写的", () => {
    const at = dir()
    writeFileSync(join(at, ENGINES_FILE), "{ 这不是 JSON", "utf8")
    const done = addEngineEntry(at, "zcode", { label: "ZCode", command: "a" })
    expect(done.ok).toBe(false)
    expect(readFileSync(join(at, ENGINES_FILE), "utf8")).toBe("{ 这不是 JSON")
  })

  it("空参数不写进去——`args: []` 和「没有 args」在文件里该长一个样", () => {
    const at = dir()
    addEngineEntry(at, "a", { label: "A", command: "a", args: [], env: {} })
    const raw = JSON.parse(readFileSync(join(at, ENGINES_FILE), "utf8")) as Record<string, unknown>
    expect(Object.hasOwn(raw["a"] as object, "args")).toBe(false)
    expect(Object.hasOwn(raw["a"] as object, "env")).toBe(false)
  })

  it("环境与注册表来源照写，读回来一样", () => {
    const at = dir()
    const registry = { id: "auggie", version: "0.36.0", kind: "npx" } as const
    addEngineEntry(at, "auggie", {
      label: "Auggie CLI", command: "npx", args: ["-y", "@augmentcode/auggie@0.36.0", "--acp"],
      env: { AUGMENT_DISABLE_AUTO_UPDATE: "1" }, registry,
    })
    expect(readEngineFile(at, log)["auggie"]).toEqual({
      label: "Auggie CLI", command: "npx", args: ["-y", "@augmentcode/auggie@0.36.0", "--acp"],
      env: { AUGMENT_DISABLE_AUTO_UPDATE: "1" }, registry,
    })
  })
})

describe("换掉与删掉 engines.json 里的一条", () => {
  const dir = (content: Record<string, unknown>): string => {
    const at = mkdtempSync(join(tmpdir(), "omni-edit-"))
    writeFileSync(join(at, ENGINES_FILE), JSON.stringify(content), "utf8")
    return at
  }
  const raw = (at: string): Record<string, Record<string, unknown>> =>
    JSON.parse(readFileSync(join(at, ENGINES_FILE), "utf8")) as Record<string, Record<string, unknown>>

  it("换：新的字段盖上去，人手加的 compact / 不认识的键原样留着，别的条目一字不动", () => {
    const at = dir({
      _说明: ["别删我"],
      gemini: { label: "Gemini", command: "npx", args: ["-y", "@google/gemini-cli@0.60.0"], compact: true, 手加的: 1 },
      other: { label: "O", command: "o" },
    })
    const done = replaceEngineEntry(at, "gemini", {
      label: "Gemini CLI", command: "npx", args: ["-y", "@google/gemini-cli@0.61.0", "--acp"],
      registry: { id: "gemini", version: "0.61.0", kind: "npx" },
    })
    expect(done).toEqual({ ok: true, id: "acp:gemini" })
    const file = raw(at)
    expect(file["gemini"]).toEqual({
      label: "Gemini CLI", command: "npx", args: ["-y", "@google/gemini-cli@0.61.0", "--acp"],
      registry: { id: "gemini", version: "0.61.0", kind: "npx" }, compact: true, 手加的: 1,
    })
    expect(file["other"]).toEqual({ label: "O", command: "o" })
    expect(file["_说明"]).toEqual(["别删我"])
  })

  it("换一条不存在的不能悄悄变成加", () => {
    const at = dir({})
    expect(replaceEngineEntry(at, "nope", { label: "N", command: "n" }).ok).toBe(false)
    expect(raw(at)).toEqual({})
  })

  it("删：只删这一个键；删不存在的照实说", () => {
    const at = dir({ _说明: ["x"], a: { command: "a" }, b: { command: "b" } })
    expect(removeEngineEntry(at, "a")).toEqual({ ok: true, id: "acp:a" })
    expect(raw(at)).toEqual({ _说明: ["x"], b: { command: "b" } })
    expect(removeEngineEntry(at, "a").ok).toBe(false)
  })

  it("文件坏了不删也不换", () => {
    const at = mkdtempSync(join(tmpdir(), "omni-edit-"))
    writeFileSync(join(at, ENGINES_FILE), "[1,2]", "utf8")
    expect(removeEngineEntry(at, "a").ok).toBe(false)
    expect(replaceEngineEntry(at, "a", { label: "A", command: "a" }).ok).toBe(false)
    expect(readFileSync(join(at, ENGINES_FILE), "utf8")).toBe("[1,2]")
  })
})
