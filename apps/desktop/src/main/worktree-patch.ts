interface Request {
  run: (args: readonly string[], maxBuffer: number) => Promise<string>
  baseline: string
  current: string
  rel: string
  context: number
}

const LIST_BUFFER = 16_000_000
const PATCH_BUFFER = 2_000_000

function renameFrom(raw: string, rel: string): string | undefined {
  const parts = raw.split("\0")
  for (let index = 0; index < parts.length; index += 1) {
    const mark = parts[index] ?? ""
    if (!mark.startsWith("R") && !mark.startsWith("C")) continue
    if (parts[index + 2] === rel) return parts[index + 1]
    index += 2
  }
  return undefined
}

/** 先认出改名旧路径，再取单文件 tree-to-tree 补丁；只给新路径会被 Git 画成整份新增。 */
export async function treePatch(request: Request): Promise<string> {
  const prefix = ["diff-tree", "-r", "--no-commit-id", "-M"]
  const names = await request.run(
    [...prefix, "-z", "--name-status", request.baseline, request.current],
    LIST_BUFFER,
  )
  const from = renameFrom(names, request.rel)
  const paths = from === undefined ? [request.rel] : [from, request.rel]
  const unified = `--unified=${String(Math.max(0, Math.min(request.context, 99_999)))}`
  return request.run(
    [...prefix, "--no-color", unified, request.baseline, request.current, "--", ...paths],
    PATCH_BUFFER,
  )
}
