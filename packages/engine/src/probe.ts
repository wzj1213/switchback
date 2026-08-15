import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { lookupCommand } from "./platform.js"

const run = promisify(execFile)

/**
 * 「这台机器上装了吗」的三种答案。
 *
 * **三态不是过度设计，两态才是错的。** 把「查不出来」压成「没装」会灰掉一个
 * 其实能用的引擎——用户于是相信自己没装，去装第二遍。反过来压成「装了」，
 * 他会一直点一个必然失败的东西。这两种错都比多一档昂贵。
 *
 * Claude 就是「查不出来」的现实例子：它的 CLI 由 SDK 自己解析，
 * 不一定在 PATH 上。`which claude` 查不到**不代表**它跑不起来。
 */
export type ProbeState = "ok" | "missing" | "unknown"

export interface Probe {
  state: ProbeState
  /** 给人看的一句话。`missing` 时必须说得出下一步做什么。 */
  detail: string
}

const VERSION_MS = 5000

/**
 * 探一个命令。
 *
 * 分三步问，对应三种答案：在不在 PATH 上 → 跑不跑得起来 → 版本是多少。
 * 只问第一步是不够的：装了但装坏了（依赖缺失、架构不对）在 `which` 那关看不出来。
 */
export async function probeCommand(command: string, hint?: string): Promise<Probe> {
  // `which` 是 POSIX 的；Windows 上是 `where.exe`。写死 `which` 的话，
  // Windows 上每一家引擎都会被报成「没装」——见 `platform.ts`
  const lookup = lookupCommand()
  const found = await run(lookup.command, lookup.args(command)).catch(() => undefined)
  if (found === undefined) {
    return { state: "missing", detail: [`\`${command}\` 不在 PATH 上。`, hint].filter(Boolean).join("") }
  }
  const path = found.stdout.trim()
  const version = await run(command, ["--version"], { timeout: VERSION_MS }).catch(() => undefined)
  if (version === undefined) {
    return { state: "missing", detail: `\`${path}\` 在，但 \`${command} --version\` 跑不起来——装坏了或版本不兼容。` }
  }
  return { state: "ok", detail: `${path} — ${version.stdout.trim().split("\n")[0] ?? ""}` }
}
