import { hasFlag } from "./command.js"
import type { Normalized } from "./classify.js"
import { isInside, matchesAnyPrefix } from "./path.js"
import type { Action, Request, SessionState, Trust } from "./types.js"

export interface RedlineContext {
  norm: Normalized
  req: Request
  state: SessionState
}

export interface Redline {
  id: string
  describe: string
  hit(ctx: RedlineContext): boolean
  action(trust: Trust): Action
  /** 写给引擎读的理由，让它能改方案而不是撞墙 */
  reason: string
  /** 是否允许被记忆规则豁免。除网络外一律 false。 */
  memorable: boolean
}

const CREDENTIAL_PREFIXES = [
  "~/.ssh", "~/.aws", "~/.gnupg", "~/.config/gh", "~/.kube", "~/.docker",
  "~/.npmrc", "~/.netrc", "~/.pypirc",
] as const

const ENGINE_HOME_PREFIXES = ["~/.claude", "~/.codex", "~/.omni", "~/.config/omni"] as const

/** 带写入语义的常见程序。用于判断 exec 是否可能写到工作区外。 */
const WRITING_PROGRAMS: ReadonlySet<string> = new Set([
  "cp", "mv", "rm", "tee", "dd", "chmod", "chown", "ln", "mkdir", "touch",
  "truncate", "install", "rsync", "unzip", "tar",
])

const always = (a: Action) => () => a

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
    describe: "命令含无法静态判定的结构",
    hit: (ctx) => ctx.norm.split.unparseable,
    action: always("escalate"),
    reason: "命令包含命令替换/eval/source 等结构，无法静态判定影响范围，需要人工确认",
    memorable: false,
  },
  {
    id: "credential-read",
    describe: "读取凭据文件或钥匙串",
    hit: (ctx) =>
      ctx.norm.paths.some(
        (p) => matchesAnyPrefix(p, CREDENTIAL_PREFIXES, ctx.state.home) || isDotEnv(p),
      ) || segmentSignatureIs(ctx.norm, "security"),
    action: always("deny"),
    reason: "拒绝访问凭据文件。如果任务确实需要某个密钥，请说明用途并让用户手工提供，不要直接读取凭据文件",
    memorable: false,
  },
  // ↓ 这两条比「工作区外写」更具体，必须排在它前面，否则会被泛规则抢先命中、
  //   用户看到的理由就变成「不在工作区内」而不是「这会改掉引擎自己的权限配置」。
  {
    id: "engine-settings-write",
    describe: "修改引擎自身配置",
    hit: (ctx) =>
      ctx.norm.category === "write" &&
      ctx.norm.paths.some((p) => matchesAnyPrefix(p, ENGINE_HOME_PREFIXES, ctx.state.home)),
    action: always("escalate"),
    reason: "该路径是引擎或 omni 自身的配置，改动会静默改变权限行为，必须人工确认",
    memorable: false,
  },
  {
    id: "omni-self-config",
    describe: "修改本项目的 omni 状态",
    hit: (ctx) =>
      ctx.norm.category === "write" &&
      ctx.norm.paths.some((p) => isInside(`${ctx.state.worksite}/.omni`, p)),
    action: always("escalate"),
    reason: ".omni 目录保存本项目的审批记忆与会话状态，不能由 agent 自行修改",
    memorable: false,
  },
  {
    id: "rm-outside-worksite",
    describe: "在工作区外递归删除",
    hit: (ctx) => hasProgramWithFlag(ctx.norm, "rm", "-r", "-f", "--recursive", "--force") && anyPathOutside(ctx),
    action: always("deny"),
    reason: "拒绝在工作区外递归删除。请把操作限制在当前工作区内",
    memorable: false,
  },
  {
    id: "write-outside-worksite",
    describe: "工作区外写入",
    hit: (ctx) => ctx.norm.category === "write" && anyPathOutside(ctx),
    action: (trust) => (trust === "read-only" ? "deny" : "escalate"),
    reason: "目标路径不在当前工作区内。若确需修改，请说明理由；只读档下一律拒绝",
    memorable: false,
  },
  {
    id: "exec-writes-outside-worksite",
    describe: "命令看起来会写到工作区外",
    hit: (ctx) =>
      ctx.norm.category === "exec" &&
      anyPathOutside(ctx) &&
      ctx.norm.split.segments.some(
        (s) => WRITING_PROGRAMS.has(s.program) || (s.program === "sed" && hasFlag(s, "-i")),
      ),
    action: (trust) => (trust === "full" ? "allow" : "escalate"),
    reason: "命令带有写入语义且目标疑似在工作区外，需要人工确认",
    memorable: false,
  },
  {
    id: "write-unknown-target",
    describe: "写操作但判不出目标路径",
    hit: (ctx) => ctx.norm.category === "write" && ctx.norm.paths.length === 0,
    action: always("escalate"),
    reason: "无法从参数中判定写入目标，需要人工确认",
    memorable: false,
  },
  {
    id: "git-push",
    describe: "推送到远端",
    hit: (ctx) => segmentSignatureIs(ctx.norm, "git push"),
    action: always("escalate"),
    reason: "推送到远端是对外可见的不可逆动作，必须人工确认",
    memorable: false,
  },
  {
    id: "git-destructive",
    describe: "丢弃未提交改动或未跟踪文件",
    hit: (ctx) =>
      gitSubcommandWithFlag(ctx.norm, "reset", "--hard") ||
      gitSubcommandWithFlag(ctx.norm, "clean", "-f", "--force") ||
      gitSubcommandWithFlag(ctx.norm, "checkout", "--force"),
    action: always("escalate"),
    reason: "该命令会丢弃未提交改动或未跟踪文件，无法恢复，必须人工确认",
    memorable: false,
  },
  {
    id: "global-install",
    describe: "安装全局包",
    hit: (ctx) =>
      ctx.norm.split.segments.some(
        (s) =>
          (["npm", "pnpm", "yarn", "bun"].includes(s.program) && hasFlag(s, "-g", "--global")) ||
          (s.program === "brew" && s.operands[0] === "install") ||
          (["pip", "pip3"].includes(s.program) && s.operands[0] === "install"),
      ),
    action: always("escalate"),
    reason: "全局安装会污染宿主环境，必须人工确认。优先考虑项目内依赖",
    memorable: false,
  },
  {
    id: "network",
    describe: "网络访问",
    hit: (ctx) => ctx.norm.category === "net" || ctx.norm.hosts.length > 0,
    action: (trust) => (trust === "read-only" ? "deny" : trust === "full" ? "allow" : "escalate"),
    reason: "网络访问需要确认目标主机",
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
