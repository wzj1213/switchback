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
    // 这条以前是**假绿**：`pnpm test` 根本不命中任何红线，走的是 trustVerdict
    // 那条早已 deny 的路，压根没经过「记忆能不能翻案」那段代码
    name: "只读档：记忆不能把 deny 变 allow（不命中红线的那条路）",
    trust: "read-only",
    req: bash("pnpm test"),
    memory: [rule("m", { commandSignature: "pnpm test" })],
    action: "deny",
  },
  {
    // **真正走 memorable 红线那条路的用例。** 网络红线在 read-only 下是
    // `deny` 且 `memorable: true`——旧代码只看 memorable 不看 action，
    // 于是这里会返回 allow
    name: "只读档：记过的 host **也不能**把网络红线的 deny 翻成 allow",
    trust: "read-only",
    req: tool("WebFetch", { url: "https://a.com/x" }),
    memory: [rule("h", { host: "a.com" })],
    action: "deny",
    redline: "network",
  },
  {
    name: "只读档：auto-edit 时记下的命令签名，降档之后一样不放行——**档位是地板**",
    trust: "read-only",
    req: bash("curl https://a.com/x"),
    memory: [rule("sig", { commandSignature: "curl" })],
    action: "deny",
  },
  {
    name: "自动档：记过的 host 才是记忆该起作用的地方（escalate → allow）",
    trust: "auto-edit",
    req: tool("WebFetch", { url: "https://a.com/x" }),
    memory: [rule("h", { host: "a.com" })],
    action: "allow",
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
  // **`>` 重定向是 shell 里最常见的写文件方式，而它和程序名无关。**
  // 原来只按程序名判断（cp/mv/tee…），于是这一条一路放行——
  // 2026-08-15 实测在「自动编辑」档下真的把 /tmp 里的文件写出来了，一次没问，
  // 而那一档在界面上写的是「工作区内的改动直接放行，越界才问」
  { name: "红线：重定向写到工作区外要问", trust: "auto-edit", req: bash("echo ok > /tmp/x.txt"), action: "escalate", redline: "exec-writes-outside-worksite" },
  { name: "红线：追加重定向到工作区外也要问", trust: "auto-edit", req: bash("echo ok >> /etc/hosts"), action: "escalate", redline: "exec-writes-outside-worksite" },
  { name: "重定向到工作区**里面**不用问——那正是这一档要放行的东西", trust: "auto-edit", req: bash("echo ok > out.txt"), action: "allow" },
  { name: "重定向到 /dev/null 不用问", trust: "auto-edit", req: bash("noisy 2>/dev/null"), action: "allow" },
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

describe("问的是什么，就得记什么", () => {
  it("网络红线建议的规则**带 host**，不是一条无约束的 curl 签名", () => {
    const v = decide(bash("curl https://registry.npmjs.org/x"), state("auto-edit"))
    expect(v.action).toBe("escalate")
    expect(v.suggest?.pattern).toEqual({ host: "registry.npmjs.org" })
  })

  it("**旧行为会记成 `{commandSignature:\"curl\"}`**——那等于放行任意主机的任意 curl", () => {
    const v = decide(bash("curl https://registry.npmjs.org/x"), state("auto-edit"))
    expect(v.suggest?.pattern ?? {}).not.toHaveProperty("commandSignature")
  })

  it("认不出唯一主机时**不给建议**：记一条无约束的签名比不记糟得多", () => {
    const v = decide(bash("curl https://a.com/x https://b.com/y"), state("auto-edit"))
    expect(v.suggest).toBeUndefined()
  })

  it("**不再产出任何命令签名规则**——那条分支只有通过这个 bug 才走得到，已删", () => {
    for (const cmd of ["curl https://a.com/x", "npm i -g typescript", "git push origin main"]) {
      expect(decide(bash(cmd), state("auto-edit")).suggest?.pattern ?? {}).not.toHaveProperty("commandSignature")
    }
  })
})

describe("裸相对路径也得当成路径", () => {
  const w = "auto-edit" as const

  it("`cat .env` 拒绝——以前只有 `cat ./.env` 才拦得住，同一件事换个写法就过", () => {
    expect(decide(bash("cat .env"), state(w)).action).toBe("deny")
  })

  it("`grep -r secret .env` 同理", () => {
    expect(decide(bash("grep -r secret .env"), state(w)).action).toBe("deny")
  })

  it("`cat $HOME/.ssh/id_rsa` 拒绝——只认 `~` 的话它会被解析到工作区里面去", () => {
    expect(decide(bash("cat $HOME/.ssh/id_rsa"), state(w)).action).toBe("deny")
  })

  it("`cat ${HOME}/.aws/credentials` 同理", () => {
    expect(decide(bash("cat ${HOME}/.aws/credentials"), state(w)).action).toBe("deny")
  })

  it("**工作区内的 `.ssh/xxx` 不该被当成用户的密钥**——那是项目里的文件", () => {
    expect(decide(bash("cat .ssh/config"), state(w)).action).toBe("allow")
  })

  it("**普通词不能被误当成路径**：`git status`、`npm run build` 照旧放行", () => {
    expect(decide(bash("git status"), state(w)).action).toBe("allow")
    expect(decide(bash("npm run build"), state(w)).action).toBe("allow")
  })

  it("flag 不算路径（`-rf` 不是文件）", () => {
    expect(decide(bash("ls -la"), state(w)).action).toBe("allow")
  })
})

describe("间接执行不能绕过路径红线", () => {
  const w = "auto-edit" as const
  const asks = (cmd: string): boolean => decide(bash(cmd), state(w)).action !== "allow"

  it("`env sh -c '…'`：剥掉执行器前缀才认得出这是包壳", () => {
    expect(asks("env sh -c 'cat ~/.ssh/id_rsa'")).toBe(true)
  })

  it("`sh -c '…' 后面还跟参数` 也要认——原来尾部锚死就不认了", () => {
    expect(asks("sh -c 'cat ~/.ssh/id_rsa' extra")).toBe(true)
  })

  it("`find -exec`：真正要跑的东西藏在参数里", () => {
    expect(asks("find ~ -name id_rsa -exec cat {} ;")).toBe(true)
  })

  it("`xargs`：要跑什么取决于 stdin，静态判不出", () => {
    expect(asks("xargs -a list.txt rm -rf")).toBe(true)
  })

  it("解释器 `-c` / `-e` 内联脚本", () => {
    expect(asks(`python3 -c 'import os;os.remove("/Users/x/.zshrc")'`)).toBe(true)
    expect(asks(`node -e 'require("fs").writeFileSync("/Users/x/.zshrc","x")'`)).toBe(true)
  })

  it("**跑脚本文件不受影响**：`node build.js`、`python3 main.py` 照旧放行", () => {
    expect(asks("node build.js")).toBe(false)
    expect(asks("python3 main.py")).toBe(false)
  })

  it("`timeout 30 pnpm test` 剥完还是普通命令，照旧放行", () => {
    expect(asks("timeout 30 pnpm test")).toBe(false)
  })
})

describe("`cd` 之后相对路径按新目录算", () => {
  const w = "auto-edit" as const

  it("`cd /tmp && echo x > victim.txt` 要问——以前按工作区解析，算出个工作区内的假路径", () => {
    expect(decide(bash("cd /tmp && echo pwned > victim.txt"), state(w)).action).toBe("escalate")
  })

  it("`cd ~/.claude && echo {} > settings.json`：静默改引擎自己的配置", () => {
    expect(decide(bash("cd ~/.claude && echo {} > settings.json"), state(w)).action).not.toBe("allow")
  })

  it("**cd 到工作区子目录仍然放行**——那正是这一档要放行的东西", () => {
    expect(decide(bash("cd src && echo x > out.txt"), state(w)).action).toBe("allow")
  })

  it("没 cd 时行为不变", () => {
    expect(decide(bash("echo x > out.txt"), state(w)).action).toBe("allow")
    expect(decide(bash("echo x > /tmp/out.txt"), state(w)).action).toBe("escalate")
  })

  it("`cd` 目标静态判不出（变量、`cd -`、无参）时整条交人工", () => {
    expect(decide(bash("cd $DIR && rm -rf ."), state(w)).action).toBe("escalate")
    expect(decide(bash("cd - && rm -rf ."), state(w)).action).toBe("escalate")
  })
})
