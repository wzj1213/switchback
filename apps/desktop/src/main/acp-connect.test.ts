import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { AcpTrial } from "@switchback/engine"
import type { ConnectProgress } from "../shared/acp-registry.js"
import { connectAgent, type ConnectDeps } from "./acp-connect.js"
import { parseRegistry } from "./acp-registry-model.js"
import { ENGINES_FILE } from "./engines.js"

const AGENTS = parseRegistry({ agents: [
  { id: "gemini", name: "Gemini CLI", version: "0.61.0", distribution: { npx: { package: "@google/gemini-cli@0.61.0", args: ["--acp"] } } },
  { id: "goose", name: "goose", version: "1.52.0", distribution: { binary: { "darwin-aarch64": { archive: "https://x/goose.tar.bz2", cmd: "./goose", args: ["acp"] } } } },
] })

const OK: AcpTrial = { ok: true, protocolVersion: 1, capabilities: [], authMethods: [{ id: "oauth", name: "Log in", kind: "agent" }] }

function setup(options: { trial?: AcpTrial; file?: unknown; npx?: boolean; inUse?: boolean } = {}) {
  const userData = mkdtempSync(join(tmpdir(), "switchback-connect-"))
  if (options.file !== undefined) writeFileSync(join(userData, ENGINES_FILE), JSON.stringify(options.file), "utf8")
  const steps: ConnectProgress["phase"][] = []
  const trials: unknown[] = []
  const refreshed: number[] = []
  const deps: ConnectDeps = {
    userData, home: "/home/dev", platform: "darwin-aarch64",
    log: { file: "", write: () => undefined },
    registry: () => Promise.resolve({ agents: AGENTS, source: "cache", fetchedAt: 1 }),
    launchers: () => Promise.resolve({ npx: options.npx ?? true, uvx: false }),
    install: (agent) => Promise.resolve({ ok: true, command: `/data/agents/${agent.id}/${agent.version}/goose` }),
    trial: (req) => {
      trials.push(req)
      return Promise.resolve(options.trial ?? OK)
    },
    refresh: () => {
      refreshed.push(1)
      return Promise.resolve()
    },
    inUse: () => options.inUse ?? false,
    progress: (step) => steps.push(step.phase),
  }
  const file = (): Record<string, unknown> => JSON.parse(readFileSync(join(userData, ENGINES_FILE), "utf8")) as Record<string, unknown>
  return { deps, steps, trials, refreshed, file }
}

describe("从注册表接一家", () => {
  it("npx：试接通过才写，写的是注册表原样的命令与来源，写完当场接上", async () => {
    const h = setup()
    const done = await connectAgent("gemini", h.deps)
    expect(done).toMatchObject({ ok: true, name: "gemini", id: "acp:gemini" })
    expect(done.trial?.authMethods?.[0]?.id).toBe("oauth")
    expect(h.trials).toEqual([{ command: "npx", args: ["-y", "@google/gemini-cli@0.61.0", "--acp"], cwd: "/home/dev", timeoutMs: 180_000 }])
    expect(h.file()["gemini"]).toEqual({
      label: "Gemini CLI", command: "npx", args: ["-y", "@google/gemini-cli@0.61.0", "--acp"],
      registry: { id: "gemini", version: "0.61.0", kind: "npx" },
    })
    expect(h.steps).toEqual(["trial", "write"])
    expect(h.refreshed).toHaveLength(1)
  })

  it("二进制：先装，命令写装好的绝对路径", async () => {
    const h = setup()
    const done = await connectAgent("goose", h.deps)
    expect(done.ok).toBe(true)
    expect(h.file()["goose"]).toMatchObject({ command: "/data/agents/goose/1.52.0/goose", args: ["acp"], registry: { kind: "binary" } })
    expect(h.steps).toEqual(["download", "trial", "write"])
  })

  it("试接没过：一个字都不写；npx 超时要补一句怎么先让它下载完", async () => {
    const h = setup({ trial: { ok: false, error: "180 秒内没有回应。", stderr: "npm http fetch…" } })
    const done = await connectAgent("gemini", h.deps)
    expect(done.ok).toBe(false)
    expect(done.error).toContain("先在终端里跑一次")
    expect(done.stderr).toBe("npm http fetch…")
    expect(() => h.file()).toThrow()
    expect(h.refreshed).toHaveLength(0)
  })

  it("接过同一家就是升级：换掉那一条（键沿用、人手加的字段留着），不另起一条", async () => {
    const h = setup({ file: { mine: { label: "旧", command: "npx", args: ["-y", "@google/gemini-cli@0.60.0"], registry: { id: "gemini", version: "0.60.0", kind: "npx" }, compact: true } } })
    const done = await connectAgent("gemini", h.deps)
    expect(done).toMatchObject({ ok: true, name: "mine" })
    expect(Object.keys(h.file())).toEqual(["mine"])
    expect(h.file()["mine"]).toMatchObject({ args: ["-y", "@google/gemini-cli@0.61.0", "--acp"], registry: { version: "0.61.0" }, compact: true })
  })

  it("升级时有会话在用：写进去了，但照实说要等它们关掉", async () => {
    const h = setup({ inUse: true, file: { gemini: { command: "npx", registry: { id: "gemini", version: "0.60.0", kind: "npx" } } } })
    expect(await connectAgent("gemini", h.deps)).toMatchObject({ ok: true, pending: true })
  })

  it("键被手接的那条占了：换个名字，不动人家的", async () => {
    const h = setup({ file: { gemini: { label: "我自己的", command: "gemini", args: ["--experimental-acp"] } } })
    const done = await connectAgent("gemini", h.deps)
    expect(done.name).toBe("gemini-2")
    expect(h.file()["gemini"]).toEqual({ label: "我自己的", command: "gemini", args: ["--experimental-acp"] })
  })

  it("这台机器起不了它、注册表里没了：说清楚", async () => {
    expect((await connectAgent("gemini", setup({ npx: false }).deps)).error).toContain("npx")
    expect((await connectAgent("nope", setup().deps)).error).toContain("刷新")
  })
})
