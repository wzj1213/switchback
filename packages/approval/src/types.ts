import type { RememberScope, Trust } from "@omni/protocol"

export type { Trust, RememberScope }

export type Action = "allow" | "deny" | "escalate"

/** 一次权限请求。由各引擎驱动把原生请求翻译成这个形状。 */
export interface Request {
  engine: string
  /** 引擎侧的工具名原文，如 `Bash` / `shell` / `fs/write_text_file` */
  tool: string
  args: Readonly<Record<string, unknown>>
  /** 引擎当前工作目录，绝对路径 */
  cwd: string
  /** 引擎给的人话描述，仅用于展示 */
  summary?: string
}

/** 记忆规则的匹配模式。字段全部可选，全部命中才算匹配。 */
export interface RulePattern {
  tool?: string
  /** 命令归一签名，如 `pnpm test` —— 见 command.ts 的 signature() */
  commandSignature?: string
  /** 路径前缀，绝对路径 */
  pathPrefix?: string
  /** 网络 host */
  host?: string
}

export interface Rule {
  id: string
  /** 人话描述，直接显示在 UI 上，如「本项目自动允许 pnpm test *」 */
  describe: string
  pattern: RulePattern
  scope: Exclude<RememberScope, "once">
}

export interface SessionState {
  trust: Trust
  /** 工作区绝对路径，写范围判定的唯一真源 */
  worksite: string
  /** 用户 home 绝对路径。显式传入，因为本包不许读环境变量。 */
  home: string
  /** 已生效的记忆规则（session 级与 project 级合并后） */
  memory: readonly Rule[]
}

export interface Verdict {
  action: Action
  /**
   * 判定理由。**写给引擎读**——deny/escalate 时引擎能据此改方案，
   * 这比静默失败强得多。不要写成 UI 文案。
   */
  reason: string
  /** action === "allow" 且可记忆时，给出建议规则供用户勾选 */
  suggest?: Rule
  /** 命中的红线 id，用于统计与排查 */
  redline?: string
}
