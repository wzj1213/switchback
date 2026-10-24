import { hasFlag } from "./command.js"
import type { Normalized } from "./classify.js"
import { isInside, matchesAnyPrefix, resolve } from "./path.js"
import type { Action, Request, SessionState, Trust } from "./types.js"

export interface RedlineContext {
  norm: Normalized
  req: Request
  state: SessionState
}

export type RedlineId =
  | "unparseable-command"
  | "credential-read"
  | "engine-settings-write"
  | "switchback-self-config"
  | "rm-outside-worksite"
  | "write-outside-worksite"
  | "exec-writes-outside-worksite"
  | "write-unknown-target"
  | "git-push"
  | "git-destructive"
  | "global-install"
  | "network"

/**
 * 一条红线。说明与理由按 `id` 放在 `redline.messages.ts`：理由是写给引擎读的，
 * 让它能改方案而不是撞墙；同一句也出现在审批卡上，所以跟着界面语言。
 */
export interface Redline {
  id: RedlineId
  hit(ctx: RedlineContext): boolean
  action(trust: Trust): Action
  /** 是否允许被记忆规则豁免。除网络外一律 false。 */
  memorable: boolean
}

const CREDENTIAL_PREFIXES = [
  "~/.ssh", "~/.aws", "~/.gnupg", "~/.config/gh", "~/.kube", "~/.docker",
  "~/.npmrc", "~/.netrc", "~/.pypirc",
] as const

const ENGINE_HOME_PREFIXES = ["~/.claude", "~/.codex", "~/.switchback", "~/.config/switchback"] as const

/**
 * 解析不了的命令里，出现这些迹象才拦。
 *
 * ## 为什么不是「解析不了就一律拦」
 *
 * 原来是那样，结果实测下来最常触发它的是这种命令：
 *
 *     git status --short && echo "$(git branch --show-current)"
 *
 * ——一条完全无害的命令，只因为带了 `$()` 就要人点一下。而 agent 用
 * `$(pwd)`、`$(git rev-parse ...)` 是家常便饭，于是「自动编辑」这一档
 * **名存实亡**：界面上写着「工作区内直接放行」，实际每隔几条就打断你一次。
 * 打断得太频繁的后果不是更安全，是**人开始不看内容直接点允许**——
 * 那时候这道闸就真的没了。
 *
 * ## 那还拦什么
 *
 * 拦「解析不了」**且**「文本里露出了会动东西的迹象」：写文件的程序、
 * 删除、网络、提权、重定向到根、凭据路径。这是个**子串扫描**，
 * 比解析弱得多——但它要回答的问题也弱得多：不是「这条命令到底干什么」，
 * 而是「它有没有可能碰到工作区以外的东西」。
 *
 * 漏网的当然有（`base64 -d | sh` 这种）。但那一档的承诺本来就是
 * 「工作区内放行」，要一切都问该用只读档；而 codex 侧还有沙箱兜底。
 */
const OPAQUE_RISK =
  /(^|[\s;|&(])(rm|mv|cp|dd|tee|chmod|chown|ln|install|rsync|truncate|curl|wget|ssh|scp|sudo|launchctl|systemctl|kill|pkill)([\s;|&)]|$)|>{1,2}\s*[~/]|\.ssh|\.aws|\.env|credentials|id_rsa/

function smellsRisky(raw: string): boolean {
  return OPAQUE_RISK.test(raw)
}

/** 原始命令文本。解析不了的时候，我们手上只剩它。 */
function rawCommand(req: Request): string {
  const value = (req.args as Record<string, unknown> | undefined)?.["command"]
  return typeof value === "string" ? value : ""
}

/** 带写入语义的常见程序。用于判断 exec 是否可能写到工作区外。 */
const WRITING_PROGRAMS: ReadonlySet<string> = new Set([
  "cp", "mv", "rm", "tee", "dd", "chmod", "chown", "ln", "mkdir", "touch",
  "truncate", "install", "rsync", "unzip", "tar",
])

const always = (a: Action) => () => a

/**
 * 按**这一段自己的 cwd** 解析路径。段里 `cd` 过就用新目录，没有就用会话工作区。
 *
 * 段自己的 cwd 也可能是相对的（`cd sub && …`），所以先把它解析成绝对路径。
 */
function resolveIn(ctx: RedlineContext, segCwd: string | undefined, target: string): string {
  const base =
    segCwd === undefined ? ctx.state.worksite : resolve(ctx.state.worksite, segCwd, ctx.state.home)
  return resolve(base, target, ctx.state.home)
}

function anyPathOutside(ctx: RedlineContext): boolean {
  return ctx.norm.paths.some((p) => !isInside(ctx.state.worksite, p))
}

function isDotEnv(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1)
  return base === ".env" || base.startsWith(".env.")
}

function segmentSignatureIs(norm: Normalized, sig: string): boolean {
  return norm.signatures.includes(sig)
}

function hasProgramWithFlag(norm: Normalized, program: string, ...flags: string[]): boolean {
  return norm.split.segments.some((s) => s.program === program && hasFlag(s, ...flags))
}

function gitSubcommandWithFlag(norm: Normalized, sub: string, ...flags: string[]): boolean {
  return norm.split.segments.some(
    (s) => s.program === "git" && s.operands[0] === sub && hasFlag(s, ...flags),
  )
}

/**
 * 红线表。**优先级最高，不分档位，先匹配先生效。**
 * 顺序即优先级：deny 类在前，escalate 类在后。
 */
export const REDLINES: readonly Redline[] = [
  {
    id: "unparseable-command",
    hit: (ctx) =>
      ctx.norm.split.unparseable &&
      // `hard` = 真正跑的东西不是你看到的这段（eval、解释器内联脚本…），一律问；
      // 其余（取值替换）只在文本里露出会动东西的迹象时才问
      (ctx.norm.split.hard === true || smellsRisky(rawCommand(ctx.req))),
    action: always("escalate"),
    memorable: false,
  },
  {
    id: "credential-read",
    hit: (ctx) =>
      ctx.norm.paths.some(
        (p) => matchesAnyPrefix(p, CREDENTIAL_PREFIXES, ctx.state.home) || isDotEnv(p),
      ) || segmentSignatureIs(ctx.norm, "security"),
    action: always("deny"),
    memorable: false,
  },
  // ↓ 这两条比「工作区外写」更具体，必须排在它前面，否则会被泛规则抢先命中、
  //   用户看到的理由就变成「不在工作区内」而不是「这会改掉引擎自己的权限配置」。
  {
    id: "engine-settings-write",
    hit: (ctx) =>
      ctx.norm.category === "write" &&
      ctx.norm.paths.some((p) => matchesAnyPrefix(p, ENGINE_HOME_PREFIXES, ctx.state.home)),
    action: always("escalate"),
    memorable: false,
  },
  {
    id: "switchback-self-config",
    hit: (ctx) =>
      ctx.norm.category === "write" &&
      ctx.norm.paths.some((p) => isInside(`${ctx.state.worksite}/.switchback`, p)),
    action: always("escalate"),
    memorable: false,
  },
  {
    id: "rm-outside-worksite",
    hit: (ctx) => hasProgramWithFlag(ctx.norm, "rm", "-r", "-f", "--recursive", "--force") && anyPathOutside(ctx),
    action: always("deny"),
    memorable: false,
  },
  {
    id: "write-outside-worksite",
    hit: (ctx) => ctx.norm.category === "write" && anyPathOutside(ctx),
    action: (trust) => (trust === "read-only" ? "deny" : "escalate"),
    memorable: false,
  },
  {
    id: "exec-writes-outside-worksite",
    hit: (ctx) =>
      ctx.norm.category === "exec" &&
      ctx.norm.split.segments.some(
        (s) =>
          // 重定向的目标**自己就是路径**，不必等 `norm.paths` 认出来——
          // `echo ok > /tmp/x` 的 argv 里只有 `echo`、`ok`，路径抽取拿不到它
          s.redirects.some((t) => !isInside(ctx.state.worksite, resolveIn(ctx, s.cwd, t))) ||
          ((WRITING_PROGRAMS.has(s.program) || (s.program === "sed" && hasFlag(s, "-i"))) &&
            anyPathOutside(ctx)),
      ),
    action: (trust) => (trust === "full" ? "allow" : "escalate"),
    memorable: false,
  },
  {
    id: "write-unknown-target",
    hit: (ctx) => ctx.norm.category === "write" && ctx.norm.paths.length === 0,
    action: always("escalate"),
    memorable: false,
  },
  {
    id: "git-push",
    hit: (ctx) => segmentSignatureIs(ctx.norm, "git push"),
    action: always("escalate"),
    memorable: false,
  },
  {
    id: "git-destructive",
    hit: (ctx) =>
      gitSubcommandWithFlag(ctx.norm, "reset", "--hard") ||
      gitSubcommandWithFlag(ctx.norm, "clean", "-f", "--force") ||
      gitSubcommandWithFlag(ctx.norm, "checkout", "--force"),
    action: always("escalate"),
    memorable: false,
  },
  {
    id: "global-install",
    hit: (ctx) =>
      ctx.norm.split.segments.some(
        (s) =>
          (["npm", "pnpm", "yarn", "bun"].includes(s.program) && hasFlag(s, "-g", "--global")) ||
          (s.program === "brew" && s.operands[0] === "install") ||
          (["pip", "pip3"].includes(s.program) && s.operands[0] === "install"),
      ),
    action: always("escalate"),
    memorable: false,
  },
  {
    id: "network",
    hit: (ctx) => ctx.norm.category === "net" || ctx.norm.hosts.length > 0,
    action: (trust) => (trust === "read-only" ? "deny" : trust === "full" ? "allow" : "escalate"),
    memorable: true,
  },
]

export interface RedlineHit {
  redline: Redline
  action: Action
}

/** 返回第一条命中的红线。顺序即优先级。 */
export function firstRedline(ctx: RedlineContext): RedlineHit | undefined {
  for (const redline of REDLINES) {
    if (!redline.hit(ctx)) continue
    const action = redline.action(ctx.state.trust)
    if (action === "allow") continue
    return { redline, action }
  }
  return undefined
}
