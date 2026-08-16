import { execFile } from "node:child_process"
import { ipcMain } from "electron"
import type { Logger } from "./log.js"

/**
 * 引擎有没有新版。
 *
 * ## 为什么这件事该 omni 管
 *
 * 引擎是**别人装的、别人更新的**——omni 只是把它们拉起来。于是很常见的一幕是：
 * 你用着半年前装的 codex，新协议字段解析不了、新能力用不上，
 * 而界面上一个字都不说。omni 是唯一同时知道「装的是哪版」和
 * 「现在最新是哪版」的地方。
 *
 * ## 更新这件事怎么做
 *
 * 一开始只给了「复制命令」——那等于把活推回给用户。改成真按钮，
 * 但**把谨慎换个地方落实**：
 *
 * - 按之前把要执行的命令原样摆出来（不是「更新」两个字背后藏一条命令）
 * - 跑完报「从哪版到哪版」，**用重新探测的结果**，不是用我们以为的
 * - 失败时把 npm 的原文吐出来，而不是「更新失败」四个字
 *
 * 这样出了问题你知道发生过什么。靠不给按钮来回避风险，
 * 只是把风险转成了「用户自己去终端跑，而且没人告诉他跑完是什么状态」。
 *
 * ## 网络
 *
 * 查最新版要连 npm。**失败就静默**——用户没有要求过这件事，
 * 为它弹一条错误是打扰。
 */
export interface EngineVersion {
  engine: string
  installed?: string
  latest?: string
  /** 落后了。界面据此提示。 */
  stale: boolean
  /** 更新命令，给用户看，也给「一键更新」用。 */
  update?: string
}

/** 各家怎么查版本、怎么更新。**只写确实验证过的那几家。** */
const KNOWN: Readonly<Record<string, { bin: string; pkg: string }>> = {
  codex: { bin: "codex", pkg: "@openai/codex" },
}

export interface UpdateResult {
  ok: boolean
  /** 更新前装的是哪版。 */
  before?: string
  /** 更新后重新探到的版本。**重新探，不是用 npm 说的那个** */
  after?: string
  /** npm 的原文。失败时全靠它排查。 */
  output: string
}

export function installEngineVersionChannel(log: Logger): void {
  /**
   * 真的去更新。
   *
   * 用 `npm i -g <pkg>@latest`，和界面上摆出来的那条命令**逐字相同**——
   * 按钮背后藏一条不一样的命令是最不该有的事。
   */
  ipcMain.handle("omni:updateEngine", async (_e, engine: string): Promise<UpdateResult> => {
    const how = KNOWN[engine]
    if (how === undefined) return { ok: false, output: `不认识的引擎：${engine}` }
    const before = await versionOf(how.bin)
    log.write("info", "engines", `开始更新 ${engine}（当前 ${before ?? "未知"}）`)
    // 给足时间：全局安装要下载、要编译原生依赖，十几秒到一两分钟都正常
    const output = await run("npm", ["i", "-g", `${how.pkg}@latest`], 180_000)
    const after = await versionOf(how.bin)
    const ok = after !== undefined && (before === undefined || compare(after, before) > 0)
    log.write(ok ? "info" : "error", "engines", `更新 ${engine}：${before ?? "?"} → ${after ?? "?"}`)
    return {
      ok,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
      output: output ?? "npm 没有任何输出——多半是它自己没跑起来（PATH？）",
    }
  })

  ipcMain.handle("omni:engineVersions", async () => {
    const out: EngineVersion[] = []
    for (const [engine, how] of Object.entries(KNOWN)) {
      const installed = await versionOf(how.bin)
      if (installed === undefined) continue
      const latest = await latestOf(how.pkg)
      const stale = latest !== undefined && compare(installed, latest) < 0
      if (stale) log.write("info", "engines", `${engine} 有新版：${installed} → ${latest}`)
      out.push({
        engine,
        installed,
        ...(latest === undefined ? {} : { latest }),
        stale,
        ...(stale ? { update: `npm i -g ${how.pkg}@latest` } : {}),
      })
    }
    return out
  })
}

/** `codex --version` 打出来是 `codex-cli 0.145.0`，只取那串数字。 */
async function versionOf(bin: string): Promise<string | undefined> {
  const out = await run(bin, ["--version"], 5000)
  return out === undefined ? undefined : /(\d+\.\d+\.\d+)/.exec(out)?.[1]
}

async function latestOf(pkg: string): Promise<string | undefined> {
  const out = await run("npm", ["view", pkg, "version"], 12000)
  return out === undefined ? undefined : /(\d+\.\d+\.\d+)/.exec(out)?.[1]
}

/** 语义化版本比大小。**按数字比，不按字符串**——不然 `0.9.0` 会大于 `0.10.0`。 */
function compare(a: string, b: string): number {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function run(cmd: string, args: readonly string[], timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = execFile(cmd, [...args], { timeout: timeoutMs, encoding: "utf8" }, (error, stdout) => {
      resolve(error !== null && stdout === "" ? undefined : stdout)
    })
    child.on("error", () => {
      resolve(undefined)
    })
  })
}
