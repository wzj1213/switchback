import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createAcpDriver, type EngineDriver } from "@omni/engine"
import type { Logger } from "./log.js"

/**
 * 第三方 ACP 引擎的注册表。
 *
 * ## 为什么是一个文件，而不是一份内置清单
 *
 * ACP 引擎在协议层已经完全通用了（`@omni/engine` 的 `acp/` 一个驱动全接），
 * 差别只剩「这台机器上那个可执行文件叫什么、在哪」。这件事 omni 猜不了：
 *
 * - 内置一份「ZCode 用 `zcode --acp`、Kimi 用 `kimi-acp`」的清单，等于把
 *   别人的命令行参数抄进我们的代码里——对方改一次参数，我们就发一版补丁，
 *   而用户看到的是「选了 ZCode 直接报错」。
 * - 更糟的是清单会**列出没装的东西**：下拉里躺着五家，四家点了就崩。
 *
 * 所以真源是这个文件。它是空的时候，界面上就只有内置的两家——诚实。
 *
 * ## 为什么不自动 `npx -y` 拉一个下来
 *
 * 那等于在用户没说话的情况下从网上下载并执行代码。装不装、装哪个版本，
 * 是用户的决定，不是 omni 的。
 */

export interface EngineEntry {
  /** 展示名，如「ZCode」。 */
  label: string
  /** 可执行文件。绝对路径，或 PATH 上的名字。 */
  command: string
  args?: readonly string[]
  /** 覆盖在父环境之上的变量。放 API key 之类的东西。 */
  env?: Readonly<Record<string, string>>
  /**
   * 这家认不认 `session/compact` / `session/steer`。
   *
   * **ACP 的握手里没有这两位**，协议上推不出来（实测三家：kimi 与 grok 两个都是
   * `Method not found`，只有 zcode 有）。内置的两家由 `registry.ts` 直接写死，
   * 第三方只能从这里说——**这就是那条一直欠着的「递补充项的路」**。
   *
   * 不填就是没有：多给一颗点了报错的按钮，比不给更糟。
   */
  compact?: boolean
  steer?: boolean
}

export type EngineFile = Readonly<Record<string, EngineEntry>>

export const ENGINES_FILE = "engines.json"

/** 第一次打开时写进去的样板。**注释在 `_说明` 里**——JSON 没有注释。 */
const TEMPLATE = {
  _说明: [
    "这里注册讲 ACP（Agent Client Protocol）的第三方引擎。",
    "键是引擎 id，会以 acp: 前缀出现在界面上；值里的 command 是可执行文件。",
    "改完这个文件需要重启 omni 才生效。",
    "下面 example 那一条是样板，删掉它或改成你真正装了的适配器。",
  ],
  example: {
    label: "示例（把这条删掉）",
    command: "codex-acp",
    args: [] as readonly string[],
    // 这两位 ACP 握手里问不出来，只能你告诉 omni；不填就是没有。
    // 实测：zcode-acp-server 两个都有，kimi 与 grok 两个都没有
    compact: false,
    steer: false,
  },
} as const

/**
 * 读注册表。**读不出来不能影响启动**——这个文件是用户手写的，
 * 写坏 JSON 是常态，代价应该是「第三方引擎这次没加载」，不是「应用起不来」。
 */
export function readEngineFile(dir: string, log: Logger): EngineFile {
  const path = join(dir, ENGINES_FILE)
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return {}
  }
  try {
    const raw: unknown = JSON.parse(text)
    if (typeof raw !== "object" || raw === null) return {}
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).flatMap(entryOf))
  } catch (error) {
    log.write("error", "engines", `${ENGINES_FILE} 解析失败，第三方引擎这次没加载：${String(error)}`)
    return {}
  }
}

/**
 * 「这家认不认 compact / steer」那两位。
 *
 * **只认真正的 `true`**：手写的 JSON 里 `"true"`、`1` 都会出现，而这两位决定的是
 * 「给不给一颗按钮」——含糊地放行就是给一颗点了报错的。
 *
 * 单拎出来是复杂度闸门逼的（`entryOf` 加上这两条实测 13/12），但边界也对：
 * 上面那个函数管「这条能不能注册」，这里管「注册成什么能力」。
 */
function saidBy(entry: Partial<EngineEntry>): { compact?: true; steer?: true } {
  return {
    ...(entry.compact === true ? { compact: true } : {}),
    ...(entry.steer === true ? { steer: true } : {}),
  }
}

/** 下划线开头的键是说明文字，跳过。字段不全的条目一并跳过，别半残地注册。 */
function entryOf([id, value]: [string, unknown]): (readonly [string, EngineEntry])[] {
  if (id.startsWith("_") || typeof value !== "object" || value === null) return []
  const entry = value as Partial<EngineEntry>
  if (typeof entry.command !== "string" || entry.command === "") return []
  return [
    [
      id,
      {
        label: typeof entry.label === "string" && entry.label !== "" ? entry.label : id,
        command: entry.command,
        ...(Array.isArray(entry.args) ? { args: entry.args.filter((a) => typeof a === "string") } : {}),
        ...(typeof entry.env === "object" && entry.env !== null ? { env: entry.env } : {}),
        ...saidBy(entry),
      },
    ],
  ]
}

/**
 * 文件不存在就写一份样板出来。已存在**绝不覆盖**——那是用户的配置。
 * 返回路径，供菜单里「用编辑器打开」用。
 */
export function ensureEngineFile(dir: string): string {
  const path = join(dir, ENGINES_FILE)
  try {
    readFileSync(path, "utf8")
  } catch {
    writeFileSync(path, `${JSON.stringify(TEMPLATE, null, 2)}\n`, "utf8")
  }
  return path
}

export interface Registered {
  drivers: Record<string, EngineDriver>
  labels: Record<string, string>
}

/**
 * 把注册表变成驱动。
 *
 * id 一律加 `acp:` 前缀（`@omni/protocol` 的 `EngineId` 就是这么约定的）：
 * 事件流和落盘的会话里，一眼看得出这个会话是走哪条协议开的。
 * 前缀也防止第三方条目覆盖内置的 `codex` / `claude`。
 */
export function registerAcpEngines(file: EngineFile): Registered {
  const drivers: Record<string, EngineDriver> = {}
  const labels: Record<string, string> = {}
  for (const [name, entry] of Object.entries(file)) {
    const id = `acp:${name}`
    drivers[id] = createAcpDriver({
      id,
      command: entry.command,
      ...(entry.args === undefined ? {} : { args: entry.args }),
      ...(entry.env === undefined ? {} : { env: entry.env }),
      ...(entry.compact === true ? { compact: true } : {}),
      ...(entry.steer === true ? { steer: true } : {}),
    })
    labels[id] = entry.label
  }
  return { drivers, labels }
}
