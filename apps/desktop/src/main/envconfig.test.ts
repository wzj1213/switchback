import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { EnvConfig } from "../shared/hooks.js"

/**
 * 「环境」那一页的数据。
 *
 * 这里钉的是三件**只会在真机上出错**的事：codex 的信任状态对不对得上、
 * 没有的那份文件会不会被摆出来、以及打开配置文件那条通道会不会被越权用。
 */

type Handler = (event: unknown, arg?: unknown) => unknown

const handlers = new Map<string, Handler>()
const listeners = new Map<string, Handler>()
const opened: string[] = []

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
    on: (channel: string, fn: Handler) => listeners.set(channel, fn),
  },
  shell: { openPath: (path: string) => opened.push(path) },
}))

/** Claude 那一侧默认「什么都没有」，各条用例自己改。 */
const sdk = { resolve: (): unknown => ({ sources: [], effective: {} }) }
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  resolveSettings: () => Promise.resolve(sdk.resolve()),
}))

const { installEnvChannel } = await import("./envconfig.js")

const log = { file: "x", write: () => undefined }
const state = { home: "", cwd: "", kimi: "", grok: "" }

const ask = async (cwd?: string): Promise<EnvConfig> =>
  (await handlers.get("switchback:envConfig")?.(undefined, cwd)) as EnvConfig

function write(path: string, text: string): string {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, text, "utf8")
  return path
}

describe("环境配置", () => {
  beforeEach(() => {
    handlers.clear()
    listeners.clear()
    opened.length = 0
    state.home = mkdtempSync(join(tmpdir(), "switchback-codex-"))
    state.cwd = mkdtempSync(join(tmpdir(), "switchback-cwd-"))
    state.kimi = mkdtempSync(join(tmpdir(), "switchback-kimi-"))
    state.grok = mkdtempSync(join(tmpdir(), "switchback-grok-"))
    // 三家的家目录都指到临时目录：**不能读到跑测试这台机器上的真实配置**，
    // 否则这几条断言会跟着谁装了什么而变
    process.env["CODEX_HOME"] = state.home
    process.env["KIMI_CODE_HOME"] = state.kimi
    process.env["GROK_HOME"] = state.grok
    sdk.resolve = () => ({ sources: [], effective: {} })
    installEnvChannel(log)
  })

  it("codex：审过的那条标已审核，没审过的标待审核——这正是「配了却不跑」的原因", async () => {
    const project = write(
      join(state.cwd, ".codex", "config.toml"),
      `[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "sh restart.sh"\ntimeout = 60\n` +
        `[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ncommand = "sh warm.sh"\n`,
    )
    write(
      join(state.home, "config.toml"),
      `[hooks.state]\n[hooks.state."${project}:stop:0:0"]\ntrusted_hash = "sha256:abc"\n`,
    )
    const env = await ask(state.cwd)
    const source = env.sources.find((s) => s.engine === "codex" && s.scope === "project")
    expect(source?.hooks).toEqual([
      { event: "Stop", command: "sh restart.sh", timeout: 60, trust: "trusted" },
      { event: "SessionStart", command: "sh warm.sh", trust: "pending" },
    ])
  })

  it("codex：解析不了的配置要说出来，不能当成「没有钩子」", async () => {
    write(join(state.cwd, ".codex", "config.toml"), "[[hooks.Stop]\n这不是 toml")
    const env = await ask(state.cwd)
    const source = env.sources.find((s) => s.engine === "codex" && s.scope === "project")
    expect(source?.exists).toBe(true)
    expect(source?.error).toMatch(/TOML/)
  })

  it("没有的那几份文件照样摆出来：「这儿可以配」本身是信息", async () => {
    const env = await ask(state.cwd)
    const claude = env.sources.filter((s) => s.engine === "claude")
    expect(claude.map((s) => s.scope)).toEqual(["user", "project", "local"])
    expect(claude.every((s) => !s.exists)).toBe(true)
  })

  it("SDK 报什么就是什么，顺带把总开关带出来", async () => {
    const path = write(join(state.cwd, ".claude", "settings.json"), "{}")
    sdk.resolve = () => ({
      sources: [
        {
          source: "project",
          path,
          settings: { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ command: "./fmt.sh" }] }] } },
        },
      ],
      effective: { disableAllHooks: true },
    })
    const env = await ask(state.cwd)
    expect(env.disabledAll).toBe(true)
    const source = env.sources.find((s) => s.path === path)
    expect(source?.hooks).toEqual([{ event: "PreToolUse", command: "./fmt.sh", matcher: "Bash" }])
  })

  it("SDK 问不到时自己读那三份文件——整页空着比读错更糟", async () => {
    sdk.resolve = () => {
      throw new Error("这个版本没有这个 API")
    }
    write(
      join(state.cwd, ".claude", "settings.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "echo hi" }] }] } }),
    )
    const env = await ask(state.cwd)
    const source = env.sources.find((s) => s.engine === "claude" && s.scope === "project")
    expect(source?.hooks).toEqual([{ event: "Stop", command: "echo hi" }])
  })

  it("没有会话（没有工作区）时只给用户级那几份，不去编一个项目路径", async () => {
    const env = await ask(undefined)
    expect(env.cwd).toBeUndefined()
    expect(env.sources.some((s) => s.scope === "project" || s.scope === "local")).toBe(false)
  })


  it("Kimi：平表 [[hooks]]，事件写在条目自己身上", async () => {
    write(
      join(state.kimi, "config.toml"),
      `default_model = "kimi-code/k3"\n` +
        `[[hooks]]\nevent = "PreToolUse"\nmatcher = "Bash"\ncommand = "./guard.sh"\ntimeout = 30\n` +
        `[[hooks]]\nevent = "Stop"\ncommand = "./done.sh"\n`,
    )
    const env = await ask(state.cwd)
    const kimi = env.sources.filter((s) => s.engine === "kimi")
    expect(kimi.map((s) => s.scope)).toEqual(["user"])
    expect(kimi[0]?.hooks).toEqual([
      { event: "PreToolUse", command: "./guard.sh", timeout: 30, matcher: "Bash" },
      { event: "Stop", command: "./done.sh" },
    ])
  })

  it("Grok：三层配置 + 项目里的钩子文件都算", async () => {
    write(
      join(state.grok, "config.toml"),
      `[[hooks.PreToolUse]]\nmatcher = "Bash"\n[[hooks.PreToolUse.hooks]]\ncommand = "/opt/guard.sh"\n`,
    )
    write(
      join(state.cwd, ".grok", "hooks", "audit.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "./audit.sh" }] }] } }),
    )
    const env = await ask(state.cwd)
    const grok = env.sources.filter((s) => s.engine === "grok")
    // 管理员那份没有、项目 config.toml 没有，但两者都要占位摆出来；
    // 钩子文件目录家目录/项目各占一条（家目录那条这里是空占位）
    expect(grok.map((s) => `${s.scope}:${s.path.replace(state.grok, "~").replace(state.cwd, ".")}`)).toEqual([
      "managed:~/managed_config.toml",
      "user:~/config.toml",
      "user:~/hooks",
      "project:./.grok/config.toml",
      "project:./.grok/hooks/audit.json",
    ])
    expect(grok.find((s) => s.scope === "user")?.hooks).toEqual([
      { event: "PreToolUse", command: "/opt/guard.sh", matcher: "Bash" },
    ])
    expect(grok.find((s) => s.path.endsWith("audit.json"))?.hooks).toEqual([
      { event: "Stop", command: "./audit.sh" },
    ])
    // 这家不标信任：那份记录 Switchback 读不到，标了就是编
    expect(grok.every((s) => s.hooks.every((h) => h.trust === undefined))).toBe(true)
  })

  it("Grok 的钩子文件家目录那份也要读——只找项目里那份会整条漏掉", async () => {
    write(
      join(state.grok, "hooks", "audit.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: "./audit.sh" }] }] } }),
    )
    const env = await ask(state.cwd)
    const found = env.sources.find((s) => s.engine === "grok" && s.path.endsWith("hooks/audit.json"))
    expect(found?.scope).toBe("user")
    expect(found?.hooks).toEqual([{ event: "Stop", command: "./audit.sh" }])
  })

  it("Grok 的钩子文件也可以整份就是那张表（不包 hooks 那一层）", async () => {
    write(
      join(state.cwd, ".grok", "hooks", "bare.json"),
      JSON.stringify({ SessionStart: [{ hooks: [{ command: "./warm.sh" }] }] }),
    )
    const env = await ask(state.cwd)
    expect(env.sources.find((s) => s.path.endsWith("bare.json"))?.hooks).toEqual([
      { event: "SessionStart", command: "./warm.sh" },
    ])
  })

  it("没有钩子文件时给一条占位：那个目录是 grok 官方文档给的位置", async () => {
    const env = await ask(state.cwd)
    const dir = env.sources.find((s) => s.engine === "grok" && s.path.endsWith("/hooks"))
    expect(dir?.exists).toBe(false)
  })


  it("codex 的钩子还有另一个窝：~/.codex/hooks.json——只读 config.toml 会漏掉全部", async () => {
    write(
      join(state.home, "hooks.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "python3 report.py", timeout: 10 }] }],
          PreToolUse: [{ matcher: "Bash", hooks: [{ command: "python3 guard.py" }] }],
        },
      }),
    )
    // 只审过 SessionStart 那条，PreToolUse 还没——**键是蛇形的**
    write(
      join(state.home, "config.toml"),
      `[hooks.state]\n[hooks.state."${join(state.home, "hooks.json")}:session_start:0:0"]\n` +
        `trusted_hash = "sha256:abc"\n`,
    )
    const env = await ask(state.cwd)
    const source = env.sources.find((s) => s.path.endsWith(".codex-home/hooks.json") || s.path === join(state.home, "hooks.json"))
    expect(source?.hooks).toEqual([
      { event: "SessionStart", command: "python3 report.py", timeout: 10, trust: "trusted" },
      { event: "PreToolUse", command: "python3 guard.py", matcher: "Bash", trust: "pending" },
    ])
  })

  it("在家目录里开的会话：同一份文件不该被列两遍", async () => {
    // 家目录里开会话时 `<cwd>/.codex/config.toml` 就是 `~/.codex/config.toml` 本身
    process.env["CODEX_HOME"] = join(state.cwd, ".codex")
    write(
      join(state.cwd, ".codex", "config.toml"),
      `[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ncommand = "sh x.sh"\n`,
    )
    const env = await ask(state.cwd)
    const codex = env.sources.filter((s) => s.engine === "codex")
    const paths = codex.map((s) => s.path)
    expect(new Set(paths).size).toBe(paths.length)
    expect(codex.filter((s) => s.hooks.length > 0)).toHaveLength(1)
  })

  it("打开配置文件只认这一页发出去的路径——渲染层拿不到一个能打开任意文件的口子", async () => {
    const env = await ask(state.cwd)
    const known = env.sources[0]?.path ?? ""
    listeners.get("switchback:openEnvFile")?.(undefined, known)
    listeners.get("switchback:openEnvFile")?.(undefined, "/etc/passwd")
    expect(opened).toEqual([known])
  })
})
