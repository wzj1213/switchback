export interface FileReference {
  path: string
  outside: boolean
}

/** 从文件工作台交给输入框的一次性信号；at 让连续引用同一路径也各生效一次。 */
export interface ComposerFileReference {
  path: string
  at: number
}

function normalized(path: string): string {
  const slashes = path.replaceAll("\\", "/")
  if (/^[a-z]:\/?$/i.test(slashes)) return `${slashes.slice(0, 2)}/`
  return slashes.length > 1 ? slashes.replace(/\/+$/, "") : slashes
}

function comparesWithoutCase(path: string): boolean {
  return /^[a-z]:\//i.test(path)
}

/** 把用户亲手拖入的绝对路径收成工作区相对路径；外部路径保持原样，不复制文件。 */
export function fileReference(cwd: string, absolute: string): FileReference {
  const root = normalized(cwd)
  const target = normalized(absolute)
  const fold = comparesWithoutCase(root)
  const comparedRoot = fold ? root.toLowerCase() : root
  const comparedTarget = fold ? target.toLowerCase() : target
  if (comparedTarget === comparedRoot) return { path: ".", outside: false }
  const prefix = comparedRoot.endsWith("/") ? comparedRoot : `${comparedRoot}/`
  return comparedTarget.startsWith(prefix)
    ? { path: target.slice(prefix.length), outside: false }
    : { path: target, outside: true }
}

/** 空白或引号路径用 JSON 字符串保护边界；它仍是输入框里可见、可编辑的用户文本。 */
export function formatFileReference(path: string): string {
  return /[\s"\\]/.test(path) ? `@${JSON.stringify(path)}` : `@${path}`
}

/** 文件拖放和手选 @ 走同一种可见文本，不另造隐藏附件协议。 */
export function appendFileReferences(text: string, paths: readonly string[]): string {
  const unique = [...new Set(paths.filter((path) => path !== ""))]
  if (unique.length === 0) return text
  const gap = text === "" || /\s$/.test(text) ? "" : " "
  return `${text}${gap}${unique.map(formatFileReference).join(" ")} `
}
