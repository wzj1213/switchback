/**
 * 纯字符串路径运算。本包禁用 node:path（见 AGENTS.md 纯逻辑包约束）。
 * 不解析符号链接——那一层交给沙箱兜底。
 *
 * ## Windows 也要认，而且这不是「以后再说」
 *
 * 原来只认 `/` 开头是绝对路径。于是在 Windows 上 `C:\Users\alice\.aws\credentials`
 * 被当成**相对路径**拼到工作区后面，得到
 * `C:\Users\alice\proj/C:\Users\alice\.aws\credentials`——
 * **恰好以「工作区 + /」开头**，`isInside` 于是永远为真。
 * 结果是依赖路径的六条红线（凭据读取、改引擎配置、改 omni 自己的配置、
 * 越界写、越界删、命令写到界外）**同时静默失效**，而界面还写着「越界才问」。
 * 正斜杠写法 `C:/Windows/...` 一样失效，不取决于引擎用哪种分隔符。
 *
 * 现网 mac 用户碰不到（dist 脚本写死 `--mac`），暴露的是 Windows 上
 * `pnpm dev` 的开发者，以及第一次打出 win 包的那一刻。
 * 而 README 里没有任何「仅支持 macOS」的声明，所以不能按「不支持的平台」免责。
 */

/** 盘符（`C:\` / `c:/`）或 UNC（`\\server\share`）。 */
const WIN_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/

export function isAbsolute(p: string): boolean {
  return p.startsWith("/") || WIN_ABSOLUTE.test(p)
}

/**
 * 折叠 `.` `..` 与重复斜杠。不访问文件系统。
 *
 * **反斜杠先归一成正斜杠**：Windows 两种分隔符混用是常态
 *（`C:\proj/src\a.ts` 完全合法），不归一的话 `..` 折叠和前缀比较都会错。
 */
export function normalize(p: string): string {
  const unified = p.replace(/\\/g, "/")
  const absolute = isAbsolute(unified)
  const out: string[] = []
  for (const part of unified.split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      const last = out[out.length - 1]
      if (out.length > 0 && last !== "..") out.pop()
      else if (!absolute) out.push("..")
      continue
    }
    out.push(part)
  }
  const joined = out.join("/")
  if (!absolute) return joined === "" ? "." : joined
  // 盘符要留在前面：`C:/Users/x`，而不是 `/C:/Users/x`
  return /^[A-Za-z]:/.test(joined) ? joined : "/" + joined
}

/**
 * 把 `~` 和 `$HOME` 展开成 home。`home` 由调用方传入，本包不读环境。
 *
 * **`$HOME` 必须一起认。** 只认 `~` 的话，`cat $HOME/.ssh/id_rsa` 会被解析成
 * `<工作区>/$HOME/.ssh/id_rsa`——**恰好落在工作区里面**，于是凭据红线判不到，
 * 越界红线也判不到。同一件事换个写法就绕过去了。
 *
 * 别的变量（`$FOO`）不展开也不能装作认识：那种情况该判「静态判不出」交人工，
 * 而不是猜一个路径出来。
 */
export function expandHome(p: string, home: string): string {
  if (p === "~") return home
  if (p.startsWith("~/")) return home + "/" + p.slice(2)
  if (p === "$HOME" || p === "${HOME}") return home
  if (p.startsWith("$HOME/")) return home + "/" + p.slice(6)
  if (p.startsWith("${HOME}/")) return home + "/" + p.slice(8)
  return p
}

/** 相对路径按 cwd 解析成绝对路径。 */
export function resolve(cwd: string, p: string, home: string): string {
  const expanded = expandHome(p, home)
  return normalize(isAbsolute(expanded) ? expanded : cwd + "/" + expanded)
}

/**
 * child 是否在 parent 之内（含 parent 自身）。两者都必须是已归一的绝对路径。
 *
 * **盘符大小写不敏感**：Windows 上 `C:\proj` 和 `c:\proj` 是同一个地方，
 * 而引擎报上来的大小写不由我们决定。路径其余部分照旧敏感——
 * macOS 的文件系统默认不敏感，但按敏感来比只会更保守，那是对的方向。
 */
export function isInside(parent: string, child: string): boolean {
  const a = dropTrailing(normalize(parent))
  const b = normalize(child)
  if (a === "" || a === "/") return b.startsWith("/")
  if (b === a || b.startsWith(a + "/")) return true
  // 只有盘符那一个字母允许大小写不同
  if (!/^[A-Za-z]:/.test(a) || !/^[A-Za-z]:/.test(b)) return false
  const la = a[0]?.toLowerCase() + a.slice(1)
  const lb = b[0]?.toLowerCase() + b.slice(1)
  return lb === la || lb.startsWith(la + "/")
}

function dropTrailing(p: string): string {
  return p.replace(/\/+$/, "")
}

/** 路径是否命中任一前缀（前缀可含 `~`）。 */
export function matchesAnyPrefix(
  path: string,
  prefixes: readonly string[],
  home: string,
): boolean {
  return prefixes.some((prefix) => isInside(expandHome(prefix, home), path))
}
