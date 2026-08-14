import { describe, expect, it } from "vitest"
import { decide } from "./decide.js"
import type { Action, Request, Rule, SessionState, Trust } from "./types.js"

const WORKSITE = "/Users/dev/proj"
const HOME = "/Users/dev"

const state = (trust: Trust, memory: readonly Rule[] = []): SessionState => ({
  trust,
  worksite: WORKSITE,
  home: HOME,
  memory,
})

const bash = (command: string): Request => ({
  engine: "claude",
  tool: "Bash",
  args: { command },
  cwd: WORKSITE,
})

const tool = (name: string, args: Record<string, unknown> = {}): Request => ({
  engine: "claude",
  tool: name,
  args,
  cwd: WORKSITE,
})

const rule = (id: string, pattern: Rule["pattern"]): Rule => ({
  id,
  describe: id,
  pattern,
  scope: "project",
})

interface Case {
  name: string
  trust: Trust
  req: Request
  memory?: readonly Rule[]
  action: Action
  redline?: string
  suggests?: boolean
}

const CASES: readonly Case[] = [
  // ── read-only 是地板 ─────────────────────────────────────────
  { name: "只读档：读文件放行", trust: "read-only", req: tool("Read", { file_path: "a.ts" }), action: "allow" },
  { name: "只读档：写文件拒绝", trust: "read-only", req: tool("Write", { file_path: "a.ts" }), action: "deny" },
  { name: "只读档：执行命令拒绝", trust: "read-only", req: bash("ls"), action: "deny" },
  { name: "只读档：网络拒绝", trust: "read-only", req: tool("WebFetch", { url: "https://a.com/x" }), action: "deny", redline: "network" },
  {
    name: "只读档：记忆不能把 deny 变 allow",
    trust: "read-only",
    req: bash("pnpm test"),
    memory: [rule("m", { commandSignature: "pnpm test" })],
    action: "deny",
  },

  // ── auto-edit 是日常档，目标是几乎不打扰 ──────────────────────
  { name: "自动档：工作区内写放行", trust: "auto-edit", req: tool("Write", { file_path: "src/a.ts" }), action: "allow" },
  { name: "自动档：普通命令放行", trust: "auto-edit", req: bash("pnpm test"), action: "allow" },
  { name: "自动档：多段普通命令放行", trust: "auto-edit", req: bash("pnpm i && pnpm build"), action: "allow" },
  { name: "自动档：读工作区外文件放行", trust: "auto-edit", req: tool("Read", { file_path: "/usr/include/x.h" }), action: "allow" },

  // ── 红线：拒绝类 ────────────────────────────────────────────
  {
    name: "红线：读 ssh 私钥一律拒绝",
    trust: "full",
    req: tool("Read", { file_path: "~/.ssh/id_rsa" }),
    action: "deny",
    redline: "credential-read",
  },
  {
    name: "红线：读 .env 一律拒绝",
    trust: "full",
    req: tool("Read", { file_path: ".env.local" }),
    action: "deny",
    redline: "credential-read",
  },
  {
    name: "红线：工作区外递归删除一律拒绝",
    trust: "full",
    req: bash("rm -rf /tmp/scratch"),
    action: "deny",
    redline: "rm-outside-worksite",
  },

  // ── 红线：升级类 ────────────────────────────────────────────
  { name: "红线：git push 永远问", trust: "full", req: bash("git push origin main"), action: "escalate", redline: "git-push" },
  { name: "红线：git reset --hard 要问", trust: "auto-edit", req: bash("git reset --hard HEAD~1"), action: "escalate", redline: "git-destructive" },
  { name: "红线：git clean -fd 要问", trust: "auto-edit", req: bash("git clean -fd"), action: "escalate", redline: "git-destructive" },
  { name: "红线：工作区外写要问", trust: "auto-edit", req: tool("Write", { file_path: "/etc/hosts" }), action: "escalate", redline: "write-outside-worksite" },
  { name: "红线：命令写到工作区外要问", trust: "auto-edit", req: bash("cp build.tgz /usr/local/share/x"), action: "escalate", redline: "exec-writes-outside-worksite" },
  { name: "红线：全局安装要问", trust: "auto-edit", req: bash("npm i -g typescript"), action: "escalate", redline: "global-install" },
  { name: "红线：改引擎配置要问", trust: "full", req: tool("Write", { file_path: "~/.claude/settings.json" }), action: "escalate", redline: "engine-settings-write" },
  { name: "红线：改 .omni 要问", trust: "full", req: tool("Write", { file_path: ".omni/memory.json" }), action: "escalate", redline: "omni-self-config" },

  // ── 解析不了 → 一律 escalate，绝不放行 ────────────────────────
  { name: "无法解析：命令替换", trust: "full", req: bash("rm -rf $(cat target)"), action: "escalate", redline: "unparseable-command" },
  { name: "无法解析：反引号", trust: "auto-edit", req: bash("echo `whoami`"), action: "escalate", redline: "unparseable-command" },
  { name: "无法解析：eval", trust: "auto-edit", req: bash("eval $CMD"), action: "escalate", redline: "unparseable-command" },

  // ── 未知工具：宁可多问 ───────────────────────────────────────
  { name: "未知工具：自动档要问", trust: "auto-edit", req: tool("Frobnicate", { x: 1 }), action: "escalate" },
  { name: "未知工具：只读档拒绝", trust: "read-only", req: tool("Frobnicate", { x: 1 }), action: "deny" },

  // ── 网络与记忆 ──────────────────────────────────────────────
  {
    name: "网络：自动档首次要问，并给出记忆建议",
    trust: "auto-edit",
    req: tool("WebFetch", { url: "https://registry.npmjs.org/x" }),
    action: "escalate",
    redline: "network",
    suggests: true,
  },
  {
    name: "网络：记过就不再问",
    trust: "auto-edit",
    req: tool("WebFetch", { url: "https://registry.npmjs.org/x" }),
    memory: [rule("m", { host: "registry.npmjs.org" })],
    action: "allow",
  },
  {
    name: "网络：full 档直接放行",
    trust: "full",
    req: tool("WebFetch", { url: "https://a.com/x" }),
    action: "allow",
  },
  {
    name: "记忆不能豁免非 memorable 红线：git push 记了也要问",
    trust: "auto-edit",
    req: bash("git push"),
    memory: [rule("m", { commandSignature: "git push" })],
    action: "escalate",
    redline: "git-push",
  },
  {
    name: "记忆是全称匹配：夹带一段没记过的命令就不放行",
    trust: "auto-edit",
    req: bash("pnpm test && curl https://evil.com"),
    memory: [rule("m", { commandSignature: "pnpm test" })],
    action: "escalate",
    redline: "network",
  },
]

describe("decide", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
    const verdict = decide(testCase.req, state(testCase.trust, testCase.memory ?? []))
    expect(verdict.action).toBe(testCase.action)
    if (testCase.redline !== undefined) expect(verdict.redline).toBe(testCase.redline)
    if (testCase.suggests === true) expect(verdict.suggest).toBeDefined()
    if (verdict.action !== "allow") expect(verdict.reason).not.toBe("")
  })

  it("每条红线都至少被一个用例覆盖", async () => {
    const { REDLINES } = await import("./redline.js")
    const covered = new Set(CASES.map((c) => c.redline).filter((r): r is string => r !== undefined))
    const uncovered = REDLINES.filter((r) => !covered.has(r.id)).map((r) => r.id)
    expect(uncovered).toEqual(["write-unknown-target"])
  })
})
