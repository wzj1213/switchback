import { describe, expect, it } from "vitest"
import { authMethodsOf, authRequiredText, canLogout, type AcpAuthMethod } from "./auth.js"
import { terminalLoginOf } from "./login.js"
import type { AcpInitialize } from "./wire.js"

/**
 * 形状都取自实测回包（2026-09-26）：Gemini CLI 0.61.0、claude-agent-acp 0.81.2、
 * codex-acp 1.13.1；旧写法取自 kimi-cli 的 `kimi acp` 源码。
 */
const CASES: readonly { name: string; raw: readonly unknown[]; want: readonly AcpAuthMethod[] }[] = [
  {
    name: "没写 type 就是 agent 型（Gemini 的 oauth-personal）",
    raw: [{ id: "oauth-personal", name: "Log in with Google", description: "Log in with your Google account" }],
    want: [{ id: "oauth-personal", name: "Log in with Google", description: "Log in with your Google account", kind: "agent" }],
  },
  {
    name: "terminal 型带追加参数与环境（claude-agent-acp）",
    raw: [{ id: "claude-ai-login", name: "Claude Subscription", type: "terminal", args: ["--cli", "auth", "login", "--claudeai"], env: { A: "1", B: 2 } }],
    want: [{ id: "claude-ai-login", name: "Claude Subscription", kind: "terminal", args: ["--cli", "auth", "login", "--claudeai"], env: { A: "1" } }],
  },
  {
    name: "旧写法 _meta.terminal-auth 给的是整条命令，名字缺席就用 label",
    raw: [{ id: "login", _meta: { "terminal-auth": { command: "/opt/kimi", args: ["login"], label: "Kimi Code Login" } } }],
    want: [{ id: "login", name: "Kimi Code Login", kind: "terminal", args: ["login"], command: "/opt/kimi" }],
  },
  {
    name: "_meta.api-key 标出要 key 的那种（codex-acp 的 api-key）",
    raw: [{ id: "api-key", name: "API Key", _meta: { "api-key": { provider: "openai" } } }, { id: "chat-gpt", name: "ChatGPT" }],
    want: [{ id: "api-key", name: "API Key", kind: "agent", apiKey: true }, { id: "chat-gpt", name: "ChatGPT", kind: "agent" }],
  },
  {
    name: "认不出的型、缺 id、重复 id 都跳过，其余照留（协议要求逐项跳过）",
    raw: [{ id: "k", name: "Key", type: "env_var", varName: "X" }, { name: "无 id" }, "garbage", { id: "a", name: "A" }, { id: "a", name: "A2" }],
    want: [{ id: "a", name: "A", kind: "agent" }],
  },
  {
    name: "空名字退回 id",
    raw: [{ id: "only-id", name: "  " }],
    want: [{ id: "only-id", name: "only-id", kind: "agent" }],
  },
]

describe("authMethodsOf", () => {
  for (const one of CASES) {
    it(one.name, () => {
      expect(authMethodsOf({ authMethods: one.raw })).toEqual(one.want)
    })
  }

  it("没有 authMethods 或不是数组就是空", () => {
    expect(authMethodsOf(undefined)).toEqual([])
    expect(authMethodsOf({ authMethods: "x" as unknown as readonly unknown[] })).toEqual([])
  })
})

describe("canLogout：存在即支持", () => {
  const table: readonly [AcpInitialize["agentCapabilities"], boolean][] = [
    [{ auth: { logout: {} } }, true],
    [{ auth: { logout: null } }, false],
    [{ auth: {} }, false],
    [{}, false],
    [undefined, false],
  ]
  for (const [caps, want] of table) {
    it(JSON.stringify(caps ?? null), () => {
      expect(canLogout(caps === undefined ? {} : { agentCapabilities: caps })).toBe(want)
    })
  }
})

describe("terminalLoginOf", () => {
  const launch = { command: "npx", args: ["-y", "@agentclientprotocol/claude-agent-acp@0.81.2"], env: { A: "base", B: "keep" } }
  it("新写法：启动命令后面追加它的参数，环境同名覆盖", () => {
    const method: AcpAuthMethod = { id: "x", name: "X", kind: "terminal", args: ["--cli", "auth", "login"], env: { A: "auth" } }
    expect(terminalLoginOf(launch, method)).toEqual({
      command: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp@0.81.2", "--cli", "auth", "login"],
      env: { A: "auth", B: "keep" },
    })
  })
  it("旧写法：用它给的整条命令，不拼启动参数", () => {
    const method: AcpAuthMethod = { id: "login", name: "L", kind: "terminal", command: "/opt/kimi", args: ["login"] }
    expect(terminalLoginOf(launch, method)).toEqual({ command: "/opt/kimi", args: ["login"], env: { A: "base", B: "keep" } })
  })
})

describe("authRequiredText", () => {
  it("它自己的原话在前，登录方式与去处在后", () => {
    const text = authRequiredText("Gemini CLI", [
      { id: "a", name: "Log in with Google", kind: "agent" },
      { id: "b", name: "Gemini API key", kind: "agent" },
    ], "This client is no longer supported")
    expect(text).toContain("Gemini CLI 要先登录")
    expect(text).toContain("This client is no longer supported")
    expect(text).toContain("Log in with Google、Gemini API key")
    expect(text).toContain("安装与接入")
  })
  it("一种都没报就照实说", () => {
    expect(authRequiredText("X", [], "Authentication required")).toContain("没有报任何登录方式")
  })
})
