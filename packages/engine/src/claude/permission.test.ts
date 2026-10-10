import type { PermissionUpdate } from "@anthropic-ai/claude-agent-sdk"
import { describe, expect, it } from "vitest"
import { forcedReason, forcesHumanPrompt, sanitize, summarize, toAllow, toDeny, type AskMeta } from "./permission.js"
import { toolDetail, turnStatus } from "./translate.js"

const meta = (over: Partial<AskMeta> = {}): AskMeta => ({ toolUseID: "toolu_1", ...over })

describe("sanitize", () => {
  it("去掉控制字符并折叠空白", () => {
    expect(sanitize("a\nb\tc\u0000d")).toBe("a b c d")
  })

  it("截断超长文本", () => {
    expect(sanitize("x".repeat(400))).toHaveLength(301) // 300 + 省略号
  })
})

describe("forcesHumanPrompt", () => {
  it("普通请求不强制", () => {
    expect(forcesHumanPrompt(meta())).toBe(false)
  })

  it("用户配的 ask 规则强制打断——判定器说 allow 也要问人", () => {
    expect(forcesHumanPrompt(meta({ matchedAskRule: { source: "user", toolName: "Bash" } }))).toBe(true)
  })
})

describe("summarize", () => {
  const cases = [
    { name: "优先用 SDK 的 title", m: meta({ title: "Claude wants to read foo.txt" }), want: "Claude wants to read foo.txt" },
    { name: "没有 title 用 description", m: meta({ description: "读写 ~/Downloads" }), want: "读写 ~/Downloads" },
    { name: "都没有则回落 tool + blockedPath", m: meta({ blockedPath: "/etc/hosts" }), want: "Bash → /etc/hosts" },
    { name: "什么都没有就只有工具名", m: meta(), want: "Bash" },
  ]
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    expect(summarize("Bash", c.m)).toBe(c.want)
  })

  it("标题里的控制字符会被清掉", () => {
    expect(summarize("Bash", meta({ title: "run\n\nrm -rf" }))).toBe("run rm -rf")
  })
})

describe("PermissionResult 映射", () => {
  it("拒绝携带理由，且不掐断整轮", () => {
    const result = toDeny("工作区外写")
    expect(result).toEqual({ behavior: "deny", message: "工作区外写" })
    expect("interrupt" in result).toBe(false)
  })

  const suggestions: PermissionUpdate[] = [
    { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "git push *" }], behavior: "allow", destination: "localSettings" },
    { type: "addDirectories", directories: ["/tmp/out"], destination: "localSettings" },
    { type: "setMode", mode: "acceptEdits", destination: "session" },
  ]
  const cases: readonly { name: string; scope: "once" | "session" | "project"; guarded?: boolean; want: unknown }[] = [
    { name: "只放行这一次：不带规则", scope: "once", want: { behavior: "allow" } },
    {
      name: "此对话：只留放行类更新，目的地一律改成 session——不让 CLI 写进项目设置",
      scope: "session",
      want: {
        behavior: "allow",
        updatedPermissions: [
          { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "git push *" }], behavior: "allow", destination: "session" },
          { type: "addDirectories", directories: ["/tmp/out"], destination: "session" },
        ],
      },
    },
    { name: "本项目始终允许：由 Switchback 自己的规则表记，不再让 CLI 另记一份", scope: "project", want: { behavior: "allow" } },
    { name: "红线或 ask 规则强制的卡：此对话也不带规则", scope: "session", guarded: true, want: { behavior: "allow" } },
  ]
  for (const one of cases) {
    it(one.name, () => {
      expect(toAllow(one.scope, meta({ suggestions }), one.guarded)).toEqual(one.want)
    })
  }

  it("此对话但 SDK 没给可用的放行建议时退回普通放行", () => {
    expect(toAllow("session", meta())).toEqual({ behavior: "allow" })
    expect(toAllow("session", meta({ suggestions: suggestions.slice(2) }))).toEqual({ behavior: "allow" })
  })
})

describe("forcedReason", () => {
  it("照实写出是哪条 ask 规则，规则文本先过 sanitize", () => {
    expect(forcedReason(meta({ matchedAskRule: { source: "userSettings", toolName: "Bash", ruleContent: "git\tcommit:*" } })))
      .toBe("Claude 设置里的 ask 规则要求逐项确认：Bash(git commit:*)")
    expect(forcedReason(meta())).toBe("")
  })
})

describe("toolDetail", () => {
  const cases = [
    ["Bash", { command: "pnpm test" }, "shell"],
    ["Read", { file_path: "a.ts" }, "file_read"],
    ["Edit", { file_path: "a.ts" }, "file_edit"],
    ["WebFetch", { url: "https://a.com" }, "fetch"],
    ["Frobnicate", { x: 1 }, "other"],
  ] as const
  it.each(cases)("%s → %s", (name, input, kind) => {
    expect(toolDetail(name, input).kind).toBe(kind)
  })

  it("参数类型不对时不抛，退化成空值", () => {
    expect(toolDetail("Bash", { command: 42 })).toEqual({ kind: "shell", command: "" })
  })
})

describe("turnStatus", () => {
  it("is_error 优先于 subtype", () => {
    expect(turnStatus("success", true)).toBe("failed")
    expect(turnStatus("success", false)).toBe("completed")
    expect(turnStatus("error_max_turns", false)).toBe("interrupted")
  })
})
