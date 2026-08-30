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
 * 所以真源是这个文件。它是空的时候，界面上就只有已经验过的内置引擎——诚实。
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
   * **ACP 的握手里没有这两位**，协议上推不出来。桥接层出现路由也不够：本机
   * zcode-acp-server 0.5.1 会转发 `session/steer`，但 ZCode 后端 0.16.3 仍回
   * `Method not found`；Grok 则另有已验证的首方 interject。内置适配由 `registry.ts` 明确提供，
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
    "新加一家：存盘后去 设置 → 引擎 → 安装与版本 点「重新探测」就能用，不用重启。",
    "改已有那家的配置、或者删掉它：要重启 omni——正在跑的会话还握着旧的那份。",
    "下面 example 那一条是样板，删掉它或改成你真正装了的适配器。",
  ],
  example: {
    label: "示例（把这条删掉）",
    command: "codex-acp",
    args: [] as readonly string[],
    // 这两位 ACP 握手里问不出来，只能你告诉 omni；不填就是没有。
    // 只写真正对当前后端活体验证过的能力；桥里有路由不等于后端兑现
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
 * 重读 `engines.json` 之后发生了什么。
 *
 * 两拨分开报，因为**它们对用户的意思完全不同**：`added` 是「现在就能用了」，
 * `needsRestart` 是「我看见你改了，但这一次没法生效」。合成一句
 * 「配置已更新」的话，后一拨会被当成已经生效——而那正是最需要说清楚的一种。
 */
export interface AcpReload {
  /** 这次新接进来的（id）。它们立刻可用，不用重启。 */
  added: readonly string[]
  /** 改过的、或者从文件里删掉的（id）。**这一次不生效**，得重启。 */
  needsRestart: readonly string[]
}

/**
 * 把 `engines.json` 里新增的那几家接进来。**只加，不改也不删。**
 *
 * ## 为什么敢在运行期加
 *
 * 宿主是**用的时候**才去读 `deps.drivers[thread.engine]`（`host/session.ts`、
 * `host/branch.ts`），从不在构造时快照。所以往这个对象里加一个键，
 * 下一条会话立刻就能选到它——不需要重建宿主，也不影响任何在跑的会话。
 *
 * ## 为什么改过的和删掉的不动
 *
 * 那两种都会**换掉或抽走一个正在被使用的驱动实例**：活着的会话握着它的引用，
 * 底下还挂着引擎进程。为了省一次重启去冒「会话半路换了驱动」的险不划算，
 * 而且那种故障的样子会非常难查。所以照实报出来，让人自己决定什么时候重启。
 *
 * `known` 里存的是**注册时那份 entry 的 JSON**，用来认出「改过的」——
 * 比对驱动对象是比不出来的，它是个闭包。
 */
export function mergeAcpEngines(
  target: Registered,
  known: Map<string, string>,
  file: EngineFile,
): AcpReload {
  const added: string[] = []
  const needsRestart: string[] = []
  const seen = new Set<string>()
  for (const [name, entry] of Object.entries(file)) {
    const id = `acp:${name}`
    seen.add(id)
    const shape = JSON.stringify(entry)
    const before = known.get(id)
    if (before === shape) continue
    if (before !== undefined) {
      needsRestart.push(id)
      continue
    }
    const one = registerAcpEngines({ [name]: entry })
    Object.assign(target.drivers, one.drivers)
    Object.assign(target.labels, one.labels)
    known.set(id, shape)
    added.push(id)
  }
  // 从文件里删掉的：驱动留着（可能有会话在用），但要说出来
  for (const id of known.keys()) if (!seen.has(id)) needsRestart.push(id)
  return { added, needsRestart }
}

/** 注册时那份 entry 的形状，供 `mergeAcpEngines` 认出「改过的」。 */
export function acpShapes(file: EngineFile): Map<string, string> {
  return new Map(Object.entries(file).map(([name, entry]) => [`acp:${name}`, JSON.stringify(entry)]))
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
