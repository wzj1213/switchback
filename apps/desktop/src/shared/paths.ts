/**
 * 引擎报来的路径怎么归一。**主进程与渲染层必须用同一份**。
 *
 * ## 为什么它从渲染层搬到这里
 *
 * 这套归一里有一条 macOS 专属的别名：`/tmp` 是 `/private/tmp` 的符号链接，
 * 引擎报哪一条全看它自己怎么写。渲染层一直把它们收口成 `/private/tmp`——
 * 于是「编辑记录」「文件」清单里显示的、点开预览时递给主进程的，都是收口后的那条。
 *
 * 而主进程那份名册（`main/touched.ts`：这条会话确实读过或改过哪些文件）
 * 当时用的是 `path.resolve` 逐字比。`resolve` 不认这条别名，
 * 于是 journal 里记着 `/tmp/x`、渲染层来问 `/private/tmp/x`，两边永远对不上：
 * **引擎在 `/tmp` 下改过的文件，一律「这个文件在工作区外，而且这条会话没读过它」**——
 * 列得出来、打不开，正是 `touched.ts` 那份注释里要根治的毛病，只是换了个入口复发。
 *
 * 一份定义两处用，就不会再出现「一边收口了、另一边没有」。
 *
 * 纯词法：不碰文件系统（渲染层拿不到 `realpath`），不读时钟。
 */

export function absolute(path: string): boolean {
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

/** macOS 的 `/tmp` → `/private/tmp`。已知别名在这一处收口，别处不再各判各的。 */
function tmpAlias(path: string): string {
  if (path === "/tmp") return "/private/tmp"
  return path.startsWith("/tmp/") ? `/private${path}` : path
}

/** 不碰文件系统的词法归一。 */
export function normalizePath(raw: string): string {
  if (raw === "") return ""
  const path = raw.replace(/\\/g, "/")
  const root = rootOf(path)
  const normalized = `${root.prefix}${collapsed(root.body, root.rooted).join("/")}`
  return tmpAlias(normalized || (root.rooted ? root.prefix : "."))
}

/** 引擎路径统一到会话 cwd；用于归属、去重与和 Git 真实路径对齐。 */
export function canonicalPath(path: string, cwd: string): string {
  const normalized = normalizePath(path)
  if (normalized === "" || absolute(normalized) || cwd === "") return normalized
  return normalizePath(`${normalizePath(cwd)}/${normalized}`)
}
