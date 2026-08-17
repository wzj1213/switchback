import type { RememberScope, Trust } from "@omni/protocol"

export type { Trust, RememberScope }

export type Action = "allow" | "deny" | "escalate"

/** 一次权限请求。由各引擎驱动把原生请求翻译成这个形状。 */
export interface Request {
  engine: string
  /** 引擎侧的工具名原文，如 `Bash` / `shell` / `fs/write_text_file` */
  tool: string
  /**
   * 引擎给的**工具标签**，用来在 `tool` 认不出来时补一次分类。
   *
   * ACP 那边这一条是必需的：协议里工具的身份是 `kind`，而 `kind` 是**一张短枚举**
   * ——实测 kimi 只把 `Read/Glob/Grep/Write/Edit/Bash/Terminal/WebFetch/WebSearch/Think`
   * 这十个名字映射过去，**其余一律报 `other`**。于是它 k3 那套工具（`Shell`、
   * `ReadFile`…）全都落成 `acp:other` → `unknown` → 自动编辑档下每条都弹窗。
   * 而 `title` 里带着它自己的工具名，那是唯一还认得出方向的东西。
   *
   * **只用来补，不用来覆盖**：`tool` 认得出的时候一个字都不看这里。
   */
  toolLabel?: string
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
