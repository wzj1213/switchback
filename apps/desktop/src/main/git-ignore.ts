import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"

const exec = promisify(execFile)
const PATH_BATCH = 200

/** 批量判断路径是否命中 ignore 规则；NUL 输入输出让换行文件名也不会被拆坏。 */
export function ignoredPaths(cwd: string, paths: readonly string[]): Promise<readonly string[]> {
  if (paths.length === 0) return Promise.resolve([])
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["check-ignore", "--no-index", "-z", "--stdin"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.stdin.on("error", () => undefined)
    child.once("error", reject)
    child.once("close", (code) => {
      if (code !== 0 && code !== 1) {
        reject(new Error(Buffer.concat(stderr).toString("utf8") || `git check-ignore 退出 ${String(code)}`))
        return
      }
      resolve(Buffer.concat(stdout).toString("utf8").split("\0").filter((path) => path !== ""))
    })
    child.stdin.end(`${paths.join("\0")}\0`)
  })
}

interface OutsideTreeRequest {
  cwd: string
  tree: string
  paths: readonly string[]
  env: NodeJS.ProcessEnv
}

/** 只返回开场树里没有、且命中 ignore 的路径；树里已有的 force-added 文件可以真实核实。 */
export async function ignoredOutsideTree(request: OutsideTreeRequest): Promise<readonly string[]> {
  if (request.paths.length === 0) return []
  const batches = Array.from(
    { length: Math.ceil(request.paths.length / PATH_BATCH) },
    (_, index) => request.paths.slice(index * PATH_BATCH, (index + 1) * PATH_BATCH),
  )
  const outputs = await Promise.all(
    batches.map((paths) =>
      exec(
        "git",
        ["ls-tree", "-r", "-z", "--name-only", request.tree, "--", ...paths],
        {
          cwd: request.cwd,
          env: { ...request.env, GIT_LITERAL_PATHSPECS: "1" },
          timeout: 10_000,
          maxBuffer: 16_000_000,
        },
      ),
    ),
  )
  const captured = new Set(
    outputs.flatMap((output) => output.stdout.split("\0").filter((path) => path !== "")),
  )
  return ignoredPaths(request.cwd, request.paths.filter((path) => !captured.has(path)))
}
