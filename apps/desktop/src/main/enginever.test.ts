import { describe, expect, it } from "vitest"
import {
  createEngineVersions,
  type EngineCommandRunner,
  type EngineVersionOptions,
} from "./enginever.js"
import { compare } from "./enginever-command.js"
import type { Logger } from "./log.js"

interface FakeState {
  calls: string[]
  versions: Record<string, string>
  latest: Record<string, string>
  globals: Record<string, string>
  paths: Record<string, string>
}

const log: Logger = { file: "/tmp/enginever-test.log", write: () => undefined }

function fixture(options: Partial<EngineVersionOptions> = {}): {
  state: FakeState
  store: ReturnType<typeof createEngineVersions>
} {
  const state: FakeState = {
    calls: [],
    versions: {
      codex: "0.148.0",
      kimi: "0.37.1",
      grok: "1.0.4",
      claude: "2.1.238",
      dsh: "0.1.0-rc.6",
    },
    latest: { "@openai/codex": "0.149.0", "@moonshot-ai/kimi-code": "0.37.2", grok: "1.0.5" },
    globals: { "@openai/codex": "0.148.0", "@moonshot-ai/kimi-code": "0.37.1" },
    paths: { codex: "/opt/homebrew/bin/codex", kimi: "/opt/homebrew/bin/kimi" },
  }
  const run = fakeRunner(state)
  return { state, store: createEngineVersions(log, { ...options, run }) }
}

function fakeRunner(state: FakeState): EngineCommandRunner {
  return async (command, args) => {
    const key = [command, ...args].join(" ")
    state.calls.push(key)
    if (args[0] === "--version") return versionResponse(state, command)
    if (command === "npm") return npmResponse(state, args)
    return nativeResponse(state, key)
  }
}

function versionResponse(state: FakeState, command: string): { ok: boolean; output: string } {
  const version = state.versions[command]
  return version === undefined
    ? { ok: false, output: "ENOENT" }
    : { ok: true, output: `${command} ${version}` }
}

function npmResponse(state: FakeState, args: readonly string[]): { ok: boolean; output: string } {
  if (args[0] === "ls") return { ok: true, output: globalsJson(state.globals) }
  if (args[0] === "prefix") return { ok: true, output: "/opt/homebrew" }
  if (args[0] === "i") return installNpm(state, args[2] ?? "")
  if (args[0] !== "view") return { ok: false, output: "unexpected npm command" }
  const version = state.latest[args[1] ?? ""]
  return version === undefined ? { ok: false, output: "offline" } : { ok: true, output: version }
}

function nativeResponse(state: FakeState, key: string): { ok: boolean; output: string } {
  if (key.startsWith("which -a ")) return pathResponse(state, key.slice("which -a ".length))
  if (key === "grok update --check --json") return grokStatus(state)
  if (key === "grok update") return install(state, "grok", "grok")
  if (key === "claude update") return { ok: true, output: "Claude Code is up to date" }
  return { ok: false, output: `unexpected: ${key}` }
}

function pathResponse(state: FakeState, bin: string): { ok: boolean; output: string } {
  const path = state.paths[bin]
  return path === undefined ? { ok: false, output: "missing" } : { ok: true, output: path }
}

function globalsJson(globals: Record<string, string>): string {
  return JSON.stringify({
    dependencies: Object.fromEntries(
      Object.entries(globals).map(([name, version]) => [name, { version }]),
    ),
  })
}

function grokStatus(state: FakeState): { ok: boolean; output: string } {
  const current = state.versions["grok"] ?? ""
  const latest = state.latest["grok"] ?? ""
  return {
    ok: true,
    output: JSON.stringify({
      currentVersion: current,
      latestVersion: latest,
      updateAvailable: current !== latest,
      error: null,
    }),
  }
}

function install(
  state: FakeState,
  engine: string,
  latestKey: string,
): { ok: boolean; output: string } {
  state.versions[engine] = state.latest[latestKey] ?? state.versions[engine] ?? ""
  return { ok: true, output: `updated ${engine}` }
}

function installNpm(state: FakeState, target: string): { ok: boolean; output: string } {
  const pkg = target.replace(/@latest$/, "")
  const engine = pkg === "@openai/codex" ? "codex" : "kimi"
  const next = state.latest[pkg] ?? state.versions[engine] ?? ""
  state.versions[engine] = next
  state.globals[pkg] = next
  return { ok: true, output: `updated ${pkg}` }
}

describe("引擎版本入口", () => {
  it("预发布版本按 semver 排序，不把 DSH 的 rc 后缀算成 NaN", () => {
    const cases = [
      ["0.1.0-rc.6", "0.1.0-rc.8", -1],
      ["0.1.0-rc.10", "0.1.0-rc.8", 1],
      ["0.1.0", "0.1.0-rc.8", 1],
      ["1.0.0-alpha-beta", "1.0.0-alpha-gamma", -1],
    ] as const
    for (const [left, right, direction] of cases) {
      expect(Math.sign(compare(left, right)), `${left} / ${right}`).toBe(direction)
    }
  })

  it("按实际安装来源给五家展示正确状态与命令", async () => {
    const { store } = fixture()
    const versions = await store.get()
    expect(versions).toMatchObject([
      { engine: "claude", label: "Claude Code", stale: false },
      {
        engine: "codex",
        installed: "0.148.0",
        latest: "0.149.0",
        stale: true,
        update: "npm i -g @openai/codex@latest",
      },
      {
        engine: "kimi",
        installed: "0.37.1",
        latest: "0.37.2",
        stale: true,
        update: "npm i -g @moonshot-ai/kimi-code@latest",
      },
      { engine: "grok", installed: "1.0.4", latest: "1.0.5", stale: true, update: "grok update" },
      {
        engine: "dsh",
        installed: "0.1.0-rc.6",
        stale: false,
        detail: "版本与 profiles 由 DSH 自己管理，Switchback 不代装插件",
      },
    ])
    expect(versions[0]?.update).toBeUndefined()
  })

  it("不拿 npm 命令更新另一来源安装的 Kimi", async () => {
    const { state, store } = fixture()
    state.paths["kimi"] = "/Users/test/.local/bin/kimi"
    const kimi = (await store.get()).find((version) => version.engine === "kimi")
    expect(kimi).toMatchObject({ installed: "0.37.1", stale: false })
    expect(kimi?.update).toBeUndefined()
    expect(kimi?.detail).toContain("原安装来源")
  })

  it("轻量版 Claude 始终给原生检查键，完整版拒绝改错那一份", async () => {
    const system = fixture({ claudeExecutable: "system" })
    const claude = (await system.store.get()).find((version) => version.engine === "claude")
    expect(claude).toMatchObject({ installed: "2.1.238", update: "claude update" })
    await expect(system.store.update("claude")).resolves.toMatchObject({ ok: true, changed: false })

    const bundled = fixture()
    await expect(bundled.store.update("claude")).resolves.toMatchObject({
      ok: false,
      changed: false,
    })
    expect(bundled.state.calls).not.toContain("claude update")
  })

  it("三条可执行更新路径都在更新后重新读版本", async () => {
    const cases = [
      { engine: "codex", command: "npm i -g @openai/codex@latest" },
      { engine: "kimi", command: "npm i -g @moonshot-ai/kimi-code@latest" },
      { engine: "grok", command: "grok update" },
    ] as const
    for (const item of cases) {
      const { state, store } = fixture()
      const result = await store.update(item.engine)
      expect(result).toMatchObject({ ok: true, changed: true })
      expect(state.calls).toContain(item.command)
      expect(
        state.calls.filter((call) => call === `${item.engine} --version`).length,
      ).toBeGreaterThanOrEqual(2)
    }
  })

  it("附的说明存码不存话：缓存着的那份也照这一刻的界面语言说", async () => {
    const language: { value: "zh-CN" | "en" } = { value: "zh-CN" }
    const { store } = fixture({ locale: () => language.value })
    const dsh = async (): Promise<string | undefined> => (await store.get()).find((v) => v.engine === "dsh")?.detail
    expect(await dsh()).toBe("版本与 profiles 由 DSH 自己管理，Switchback 不代装插件")
    language.value = "en"
    expect(await dsh()).toBe("DSH manages its own versions and profiles; Switchback doesn't install plugins for it")
    expect((await store.get()).some((version) => "note" in version)).toBe(false)
  })

  it("英文界面下，更新入口不在时那句话也说英文", async () => {
    const { store } = fixture({ locale: () => "en" })
    await expect(store.update("claude")).resolves.toMatchObject({
      ok: false,
      output: "claude has no update entry point that Switchback can run right now",
    })
  })
})
