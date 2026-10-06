import { execFile } from "node:child_process"
import { mkdir, readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import type { ZcodeStatus } from "../shared/guard.js"

export type { ZcodeStatus }

/**
 * ZCode 的本机防护：它装了没有、是不是有问题的那一版、它的快照目录锁上没有。
 *
 * ## 那件事
 *
 * 2026-09-18 有人逆向出来：ZCode 登录着就在后台把整个工作区——完整 `.git` 历史、LFS 缓存、
 * reflog、全局配置——打成包、用服务端现发的公钥加密，传到阿里云 OSS（`zcode.z.ai` 的
 * `/api/v1/snapshot/upload-credential` 发凭证）。每次发话前、每次任务收尾都打一次包；
 * 设置里那两个开关管不住它。3.14.0 删掉了这条链路，随后开源，但开源仓库只有一次提交，
 * 看不出发过的版本里到底有什么。
 *
 * ## 为什么是锁目录
 *
 * 待传的包先落在 `~/.zcode/v2/checkpoints/`。删是删不完的（它发现没了就再打一个），
 * 公开的防护办法是给这个目录加不可改标志（`chflags uchg`）：它写不进新包，整条链路就断了。
 * 修好的版本不用这个目录，锁着也不碍事；要解开，关掉设置里那个开关即可（`chflags nouchg`）。
 *
 * Switchback 不删里面已有的包（那是你的数据，要不要删你来定），只报有几个、多大。
 */

const run = promisify(execFile)

/** 删掉那条链路的版本。 */
export const FIXED_VERSION = "3.14.0"


/** `3.7.7` 比 `3.14.0` 旧。逐段按数字比，不按字符串比（按字符串的话 3.7 比 3.14 新）。 */
export function olderThan(version: string, than: string): boolean {
  const a = version.split(".").map((part) => Number.parseInt(part, 10) || 0)
  const b = than.split(".").map((part) => Number.parseInt(part, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x < y
  }
  return false
}

export function checkpointsOf(home: string): string {
  return join(home, ".zcode", "v2", "checkpoints")
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

async function appOf(home: string): Promise<string | undefined> {
  for (const app of ["/Applications/ZCode.app", join(home, "Applications", "ZCode.app")]) {
    if (await exists(app)) return app
  }
  return undefined
}

async function versionOf(app: string): Promise<string | undefined> {
  try {
    const out = await run("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", join(app, "Contents", "Info.plist")])
    const version = out.stdout.trim()
    return version === "" ? undefined : version
  } catch {
    return undefined
  }
}

/** BSD 文件标志里有没有 `uchg`（`stat -f %Sf`）。Node 的 `stat` 不给这一项。 */
async function lockedOf(path: string): Promise<boolean> {
  try {
    const out = await run("stat", ["-f", "%Sf", path])
    return out.stdout.split(",").some((flag) => flag.trim() === "uchg")
  } catch {
    return false
  }
}

async function archivesOf(path: string): Promise<{ archives: number; bytes: number }> {
  const names = await readdir(path).catch(() => [] as string[])
  const sizes = await Promise.all(names.filter((name) => name.endsWith(".enc")).map((name) => stat(join(path, name)).then((s) => s.size, () => 0)))
  return { archives: sizes.length, bytes: sizes.reduce((total, size) => total + size, 0) }
}

export async function zcodeStatus(home: string): Promise<ZcodeStatus> {
  const app = await appOf(home)
  const version = app === undefined ? undefined : await versionOf(app)
  const path = checkpointsOf(home)
  const there = await exists(path)
  return {
    app,
    version,
    affected: app !== undefined && (version === undefined || olderThan(version, FIXED_VERSION)),
    checkpoints: {
      path,
      exists: there,
      locked: there && (await lockedOf(path)),
      ...(there ? await archivesOf(path) : { archives: 0, bytes: 0 }),
    },
  }
}

/**
 * 给快照目录上锁 / 解锁。
 *
 * 上锁时目录还不存在就先建出来（`~/.zcode` 在才建：没装过 ZCode 的机器上不凭空造它的目录）。
 * 返回之后的状态。
 */
export async function lockCheckpoints(home: string, lock: boolean): Promise<ZcodeStatus> {
  const path = checkpointsOf(home)
  if (lock && (await exists(join(home, ".zcode")))) {
    await mkdir(path, { recursive: true })
    await run("chflags", ["uchg", path])
  } else if (!lock && (await exists(path))) {
    await run("chflags", ["nouchg", path])
  }
  return zcodeStatus(home)
}
