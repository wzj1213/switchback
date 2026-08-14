/**
 * 纯字符串路径运算。本包禁用 node:path（见 AGENTS.md 纯逻辑包约束）。
 * 只处理 POSIX 风格；不解析符号链接——那一层交给沙箱兜底。
 */

export function isAbsolute(p: string): boolean {
  return p.startsWith("/")
}

/** 折叠 `.` `..` 与重复斜杠。不访问文件系统。 */
export function normalize(p: string): string {
  const absolute = isAbsolute(p)
  const out: string[] = []
  for (const part of p.split("/")) {
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
  if (absolute) return "/" + joined
  return joined === "" ? "." : joined
}

/** 把 `~` 展开成 home。`home` 由调用方传入，本包不读环境。 */
export function expandHome(p: string, home: string): string {
  if (p === "~") return home
  if (p.startsWith("~/")) return home + "/" + p.slice(2)
  return p
}

/** 相对路径按 cwd 解析成绝对路径。 */
export function resolve(cwd: string, p: string, home: string): string {
  const expanded = expandHome(p, home)
  return normalize(isAbsolute(expanded) ? expanded : cwd + "/" + expanded)
}

/** child 是否在 parent 之内（含 parent 自身）。两者都必须是已归一的绝对路径。 */
export function isInside(parent: string, child: string): boolean {
  const a = normalize(parent).replace(/\/+$/, "")
  const b = normalize(child)
  if (a === "" || a === "/") return b.startsWith("/")
  return b === a || b.startsWith(a + "/")
}

/** 路径是否命中任一前缀（前缀可含 `~`）。 */
export function matchesAnyPrefix(
  path: string,
  prefixes: readonly string[],
  home: string,
): boolean {
  return prefixes.some((prefix) => isInside(expandHome(prefix, home), path))
}
