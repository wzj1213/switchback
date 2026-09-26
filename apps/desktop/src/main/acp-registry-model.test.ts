import { describe, expect, it } from "vitest"
import { parseRegistry, planOf, platformOf, type RegistryAgent } from "./acp-registry-model.js"

/** 条目形状取自 2026-09-26 的真实注册表（v1.0.0，41 家），只截了用得到的字段。 */
const REAL = {
  version: "1.0.0",
  agents: [
    {
      id: "gemini", name: "Gemini CLI", version: "0.61.0", description: "Google's official CLI for Gemini",
      authors: ["Google"], license: "Apache-2.0",
      distribution: { npx: { package: "@google/gemini-cli@0.61.0", args: ["--acp"] } },
    },
    {
      id: "goose", name: "goose", version: "1.52.0",
      distribution: { binary: { "darwin-aarch64": {
        archive: "https://github.com/block/goose/releases/download/v1.52.0/goose-aarch64-apple-darwin.tar.bz2",
        cmd: "./goose", args: ["acp"], sha256: "10F7ACA02D265750F43EC6948A63757EA372B1EF52B5C116F55B79D382769AE7",
      } } },
    },
    {
      id: "kilo", name: "Kilo", version: "7.8.1",
      distribution: {
        npx: { package: "@kilocode/cli@7.8.1", args: ["acp"] },
        binary: { "darwin-aarch64": { archive: "https://github.com/Kilo-Org/kilocode/releases/download/v7.8.1/kilo-darwin-arm64.zip", cmd: "./kilo", args: ["acp"] } },
      },
    },
    { id: "fast-agent", name: "fast-agent", version: "0.10.1", distribution: { uvx: { package: "fast-agent-acp==0.10.1", args: ["-x"] } } },
    {
      id: "auggie", name: "Auggie CLI", version: "0.36.0",
      distribution: { npx: { package: "@augmentcode/auggie@0.36.0", args: ["--acp"], env: { AUGMENT_DISABLE_AUTO_UPDATE: "1" } } },
    },
  ],
}

const byId = (agents: readonly RegistryAgent[], id: string): RegistryAgent => {
  const found = agents.find((agent) => agent.id === id)
  if (found === undefined) throw new Error(`没有 ${id}`)
  return found
}

describe("platformOf", () => {
  const table: readonly [string, string, string | undefined][] = [
    ["darwin", "arm64", "darwin-aarch64"],
    ["darwin", "x64", "darwin-x86_64"],
    ["linux", "x64", "linux-x86_64"],
    ["win32", "arm64", "windows-aarch64"],
    ["freebsd", "x64", undefined],
    ["darwin", "ia32", undefined],
  ]
  for (const [platform, arch, want] of table) {
    it(`${platform}/${arch}`, () => expect(platformOf(platform, arch)).toBe(want))
  }
})

describe("parseRegistry", () => {
  const agents = parseRegistry(REAL)

  it("认得出的全留下，按名字排（不分大小写）", () => {
    expect(agents.map((agent) => agent.id)).toEqual(["auggie", "fast-agent", "gemini", "goose", "kilo"])
  })

  it("字段原样保留，sha256 统一小写", () => {
    expect(byId(agents, "gemini")).toMatchObject({
      name: "Gemini CLI", version: "0.61.0", license: "Apache-2.0", authors: ["Google"],
      npx: { package: "@google/gemini-cli@0.61.0", args: ["--acp"] },
    })
    expect(byId(agents, "goose").binary["darwin-aarch64"]?.sha256).toBe("10f7aca02d265750f43ec6948a63757ea372b1ef52b5c116f55b79d382769ae7")
    expect(byId(agents, "auggie").npx?.env).toEqual({ AUGMENT_DISABLE_AUTO_UPDATE: "1" })
  })

  const hostile: readonly { name: string; agent: unknown }[] = [
    { name: "id 带路径", agent: { id: "../x", version: "1.0.0", distribution: { npx: { package: "a" } } } },
    { name: "版本带路径", agent: { id: "x", version: "../../etc", distribution: { npx: { package: "a" } } } },
    { name: "id 以点开头", agent: { id: ".hidden", version: "1.0.0" } },
  ]
  for (const one of hostile) {
    it(`不可信字段整家丢掉：${one.name}`, () => {
      expect(parseRegistry({ agents: [one.agent] })).toEqual([])
    })
  }

  const badDist: readonly { name: string; dist: unknown }[] = [
    { name: "cmd 是绝对路径", dist: { binary: { "darwin-aarch64": { archive: "https://a/b.zip", cmd: "/bin/sh" } } } },
    { name: "cmd 往上跳", dist: { binary: { "darwin-aarch64": { archive: "https://a/b.zip", cmd: "./a/../../sh" } } } },
    { name: "归档不是 https", dist: { binary: { "darwin-aarch64": { archive: "http://a/b.zip", cmd: "./x" } } } },
    { name: "包名像选项", dist: { npx: { package: "--registry=http://evil" } } },
    { name: "包名带空白", dist: { npx: { package: "a b" } } },
  ]
  for (const one of badDist) {
    it(`不可信的分发单独丢掉，这一家还在：${one.name}`, () => {
      const [agent] = parseRegistry({ agents: [{ id: "x", version: "1.0.0", distribution: one.dist }] })
      expect(agent?.npx).toBeUndefined()
      expect(agent?.binary).toEqual({})
    })
  }

  it("坏 sha256 不当真，其余照收", () => {
    const [agent] = parseRegistry({ agents: [{ id: "x", version: "1.0.0", distribution: { binary: { "darwin-aarch64": { archive: "https://a/b.tgz", cmd: "./x", sha256: "abc" } } } }] })
    expect(agent?.binary["darwin-aarch64"]).toEqual({ archive: "https://a/b.tgz", cmd: "./x", args: [] })
  })

  it("整份不认识就是空的，重复 id 只留第一条", () => {
    expect(parseRegistry(null)).toEqual([])
    expect(parseRegistry({ agents: "x" })).toEqual([])
    expect(parseRegistry({ agents: [{ id: "a", version: "1.0.0", name: "一" }, { id: "a", version: "2.0.0", name: "二" }] }).map((a) => a.name)).toEqual(["一"])
  })
})

describe("planOf", () => {
  const agents = parseRegistry(REAL)
  const mac = "darwin-aarch64" as const
  const cases: readonly { name: string; id: string; has: { npx: boolean; uvx: boolean }; want: unknown }[] = [
    {
      name: "npx 分发：-y + 注册表给的包与参数，环境原样",
      id: "auggie", has: { npx: true, uvx: false },
      want: { plan: { kind: "npx", command: "npx", args: ["-y", "@augmentcode/auggie@0.36.0", "--acp"], package: "@augmentcode/auggie@0.36.0", env: { AUGMENT_DISABLE_AUTO_UPDATE: "1" } } },
    },
    {
      name: "两种都有、npx 在：走 npx（用户自己的 npm 配置）",
      id: "kilo", has: { npx: true, uvx: false },
      want: { plan: { kind: "npx", command: "npx", args: ["-y", "@kilocode/cli@7.8.1", "acp"], package: "@kilocode/cli@7.8.1" } },
    },
    {
      name: "两种都有、没有 npx：下载本平台的包",
      id: "kilo", has: { npx: false, uvx: false },
      want: { plan: { kind: "binary", archive: "https://github.com/Kilo-Org/kilocode/releases/download/v7.8.1/kilo-darwin-arm64.zip", cmd: "./kilo", args: ["acp"] } },
    },
    {
      name: "uvx 分发",
      id: "fast-agent", has: { npx: true, uvx: true },
      want: { plan: { kind: "uvx", command: "uvx", args: ["fast-agent-acp==0.10.1", "-x"], package: "fast-agent-acp==0.10.1" } },
    },
    { name: "只有 npx 分发而机器上没有 npx：说清少什么", id: "gemini", has: { npx: false, uvx: true }, want: { missing: expect.stringContaining("npx") as unknown } },
    { name: "只有 uvx 分发而机器上没有 uvx", id: "fast-agent", has: { npx: true, uvx: false }, want: { missing: expect.stringContaining("uvx") as unknown } },
  ]
  for (const one of cases) {
    it(one.name, () => expect(planOf(byId(agents, one.id), mac, one.has)).toEqual(one.want))
  }

  it("没有本平台的包", () => {
    expect(planOf(byId(agents, "goose"), "windows-aarch64", { npx: true, uvx: true })).toEqual({ missing: "它没有发布这个平台的包" })
    expect(planOf(byId(agents, "goose"), undefined, { npx: true, uvx: true }).missing).toBeDefined()
  })
})
