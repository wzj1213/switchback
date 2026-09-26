import { createHash, randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { chmod, copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as WebStream } from "node:stream/web"
import type { BinaryDist } from "./acp-registry-model.js"

/**
 * 注册表里只发二进制的那几家（goose、opencode、Cursor…）怎么落到这台机器上。
 *
 * ## 只在人点了「接入」之后
 *
 * `engines.ts` 开头那条仍然成立：**装不装、装哪个版本是人的决定**。所以这里不会自己跑起来，
 * 界面上先把要下载的地址、要校验的 sha256、要放到哪儿都摆出来，点了才下。
 *
 * ## 放在哪、长什么样
 *
 * `<userData>/agents/<注册表 id>/<版本>/`，每个版本一个目录，解包完整了才原子地挪进去——
 * 半截的下载永远不会出现在那个位置上，也就不会被当成「已经装好」。
 * 不碰 `/usr/local`、不改 PATH、不需要管理员权限；删掉这一家就是删掉这个目录。
 *
 * ## 校验
 *
 * 注册表给了 sha256 就逐字节比，对不上**一个文件都不解包**。没给的（少数几家）照样能装，
 * 界面上会写明「注册表没给校验值」。
 */
export interface InstallDeps {
  /** `<userData>/agents` */
  root: string
  fetch: typeof fetch
  run: (command: string, args: readonly string[], timeoutMs: number) => Promise<{ ok: boolean; output: string }>
  platform: string
  signal?: AbortSignal
  onProgress?: (phase: "download" | "extract", received?: number, total?: number) => void
}

export type InstallResult = { ok: true; command: string } | { ok: false; error: string }

const DOWNLOAD_MS = 20 * 60_000
const EXTRACT_MS = 5 * 60_000

type ArchiveKind = "zip" | "tar" | "raw"

export function archiveKindOf(url: string): ArchiveKind {
  const path = new URL(url).pathname.toLowerCase()
  if (path.endsWith(".zip")) return "zip"
  return /\.(tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar)$/u.test(path) ? "tar" : "raw"
}

/** 解包后那个可执行文件的绝对路径。**必须落在版本目录里面**——注册表已经挡过一次，这里再挡一次。 */
export function commandIn(dir: string, cmd: string): string | undefined {
  const target = resolve(dir, cmd)
  return target.startsWith(`${resolve(dir)}${sep}`) ? target : undefined
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

async function download(dist: BinaryDist, to: string, deps: InstallDeps): Promise<void> {
  const signal = deps.signal === undefined ? AbortSignal.timeout(DOWNLOAD_MS) : AbortSignal.any([deps.signal, AbortSignal.timeout(DOWNLOAD_MS)])
  const response = await deps.fetch(dist.archive, { signal })
  if (!response.ok || response.body === null) throw new Error(`下载失败：HTTP ${String(response.status)}`)
  const total = Number(response.headers.get("content-length")) || undefined
  const hash = createHash("sha256")
  const seen = { bytes: 0 }
  const count = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk)
      seen.bytes += chunk.length
      deps.onProgress?.("download", seen.bytes, total)
      done(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(response.body as WebStream<Uint8Array>), count, createWriteStream(to), { signal })
  const digest = hash.digest("hex")
  if (dist.sha256 !== undefined && digest !== dist.sha256) {
    throw new Error(`校验没过：注册表写的 sha256 是 ${dist.sha256}，下载到的是 ${digest}。没有解包。`)
  }
}

async function extract(
  from: { kind: ArchiveKind; archive: string; out: string },
  dist: BinaryDist,
  deps: InstallDeps,
): Promise<void> {
  const { kind, archive, out } = from
  if (kind === "raw") {
    const target = commandIn(out, dist.cmd)
    if (target === undefined) throw new Error("可执行文件的路径不在安装目录里")
    await mkdir(dirname(target), { recursive: true })
    await copyFile(archive, target)
    return
  }
  const [command, args] = kind === "tar"
    ? ["tar", ["-xf", archive, "-C", out]]
    : deps.platform === "darwin" ? ["ditto", ["-x", "-k", archive, out]] : ["unzip", ["-q", "-o", archive, "-d", out]]
  const done = await deps.run(command, args, EXTRACT_MS)
  if (!done.ok) throw new Error(`解包失败：${done.output.slice(-600)}`)
}

/** 下载、校验、解包、挪到位。已经装过同一个版本就直接用。 */
export async function installBinary(
  agent: { id: string; version: string },
  dist: BinaryDist,
  deps: InstallDeps,
): Promise<InstallResult> {
  const dir = join(deps.root, agent.id, agent.version)
  const target = commandIn(dir, dist.cmd)
  if (target === undefined) return { ok: false, error: "注册表给的可执行文件路径不在安装目录里，没有安装。" }
  if (await exists(target)) return { ok: true, command: target }
  const staging = join(deps.root, agent.id, `.staging-${randomUUID()}`)
  const kind = archiveKindOf(dist.archive)
  const archive = join(staging, kind === "zip" ? "archive.zip" : "archive")
  const out = join(staging, "out")
  try {
    await mkdir(out, { recursive: true })
    await download(dist, archive, deps)
    deps.onProgress?.("extract")
    await extract({ kind, archive, out }, dist, deps)
    if (commandIn(out, dist.cmd) === undefined || !(await exists(join(out, dist.cmd)))) {
      throw new Error(`解包后没找到注册表说的 ${dist.cmd}。`)
    }
    await rm(dir, { recursive: true, force: true })
    await rename(out, dir)
    await chmod(target, 0o755)
    return { ok: true, command: target }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: /abort/iu.test(message) && deps.signal?.aborted === true ? "已取消。" : message }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/**
 * 收掉没人引用的旧版本与半截下载。**只动 `<root>/<id>/` 下面的东西**。
 *
 * `keep` 是 engines.json 里所有条目的 command（绝对路径）。一个版本目录里只要还有
 * 任何一条在用的命令，就原样留着——哪怕它是个手改过的条目。
 */
export async function pruneAgents(root: string, keep: readonly string[]): Promise<readonly string[]> {
  const removed: string[] = []
  const ids = await readdir(root).catch(() => [] as string[])
  for (const id of ids) {
    const versions = await readdir(join(root, id)).catch(() => [] as string[])
    for (const version of versions) {
      const dir = join(root, id, version)
      if (keep.some((command) => command.startsWith(`${dir}${sep}`))) continue
      await rm(dir, { recursive: true, force: true })
      removed.push(dir)
    }
  }
  return removed
}
