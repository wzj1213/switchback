function absolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path)
}

function rootOf(path: string): { body: string; prefix: string; rooted: boolean } {
  const drive = /^[A-Za-z]:\//.exec(path)?.[0]
  if (drive !== undefined) return { body: path.slice(drive.length), prefix: drive, rooted: true }
  if (path.startsWith("/")) return { body: path, prefix: "/", rooted: true }
  return { body: path, prefix: "", rooted: false }
}

function collapsed(body: string, rooted: boolean): readonly string[] {
  const parts: string[] = []
  for (const part of body.split("/")) {
    if (part === "" || part === ".") continue
    if (part !== "..") {
      parts.push(part)
      continue
    }
    const last = parts.at(-1)
    if (last !== undefined && last !== "..") parts.pop()
    else if (!rooted) parts.push(part)
  }
  return parts
}

function tmpAlias(path: string): string {
  if (path === "/tmp") return "/private/tmp"
  return path.startsWith("/tmp/") ? `/private${path}` : path
}

/** 浏览器可运行的词法路径归一；对比分支不能把同一文件的相对/绝对别名拆成多行。 */
export function canonicalPath(raw: string, cwd: string): string {
  if (raw === "") return ""
  const clean = raw.replace(/\\/g, "/")
  const root = rootOf(clean)
  const normalized = tmpAlias(`${root.prefix}${collapsed(root.body, root.rooted).join("/")}`)
  if (absolute(normalized) || cwd === "") return normalized
  return canonicalPath(`${canonicalPath(cwd, "")}/${normalized}`, "")
}
