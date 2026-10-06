import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ENGINES_FILE, type RegistrySource } from "./engines.js"

/**
 * 往 `engines.json` 里**写**的那几件事：加一条、换一条、删一条、第一次写样板。
 *
 * 从 `engines.ts` 拆出来是行数闸门逼的，但边界也对：那边是「读出来注册成驱动」，
 * 这里是「按人的指令改他的文件」——后者每一步都要守同一组规矩，放在一处才守得住。
 *
 * ## 三条规矩
 *
 * 1. **读原文、只改一个键、原样写回。** `readEngineFile` 会把文件规范化（丢掉 `_说明`、
 *    丢掉不认识的字段），拿它的结果写回去等于把用户手写的东西一起删掉——
 *    用别人的配置文件当自己的数据结构用，是最容易背刺人的一种写法。
 * 2. **文件坏了就不写。** 不是 JSON、最外层不是对象：宁可让人自己去修，
 *    也不能拿一份新的把他手写的东西盖掉。
 * 3. **加不覆盖，换与删必须真的有。** 「我以为我加了一条，结果改掉了另一条」是最坏的结果；
 *    反过来，换一条不存在的也不能悄悄变成「加」。
 */

export interface AddResult {
  ok: boolean
  /** 成功时它在界面上的 id（带 `acp:` 前缀）。 */
  id?: string
  error?: string
}

/** 往文件里写的一条。和 `EngineEntry` 同形，只是字段都照写入的规矩来。 */
export interface EntryInput {
  label: string
  command: string
  args?: readonly string[]
  env?: Readonly<Record<string, string>>
  registry?: RegistrySource
}

type Loaded = { ok: true; file: Record<string, unknown> } | { ok: false; error: string }

function load(dir: string): Loaded {
  const path = join(dir, ENGINES_FILE)
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    // 文件不在是正常的（第一次用）
    return { ok: true, file: {} }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: `${ENGINES_FILE} 现在不是合法的 JSON，Switchback 不敢往里写。请先自己打开修一下。` }
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: `${ENGINES_FILE} 的最外层不是一个对象，Switchback 不敢往里写。` }
  }
  return { ok: true, file: raw as Record<string, unknown> }
}

function save(dir: string, file: Record<string, unknown>): void {
  writeFileSync(join(dir, ENGINES_FILE), `${JSON.stringify(file, null, 2)}\n`, "utf8")
}

/** 写进文件的形状。**空的不写**：`args: []` 和「没有 args」在文件里该长一个样。 */
function shapeOf(entry: EntryInput): Record<string, unknown> {
  return {
    label: entry.label,
    command: entry.command,
    ...(entry.args === undefined || entry.args.length === 0 ? {} : { args: [...entry.args] }),
    ...(entry.env === undefined || Object.keys(entry.env).length === 0 ? {} : { env: { ...entry.env } }),
    ...(entry.registry === undefined ? {} : { registry: { ...entry.registry } }),
  }
}

/** 加一条。重名不覆盖——那可能是一条正在被会话使用的配置。 */
export function addEngineEntry(dir: string, name: string, entry: EntryInput): AddResult {
  const loaded = load(dir)
  if (!loaded.ok) return { ok: false, error: loaded.error }
  if (Object.hasOwn(loaded.file, name)) {
    return { ok: false, error: `${ENGINES_FILE} 里已经有一条叫 \`${name}\` 的了。换个名字，或者先自己去改那一条。` }
  }
  loaded.file[name] = shapeOf(entry)
  save(dir, loaded.file)
  return { ok: true, id: `acp:${name}` }
}

/**
 * 换掉一条（升级到注册表里的新版本就是这样）。
 *
 * **那一条里 Switchback 不认识的字段原样留着**：人可能手加过 `compact` / `steer`，
 * 或者将来版本才认的键——升级不该把它们一起抹掉。
 */
export function replaceEngineEntry(dir: string, name: string, entry: EntryInput): AddResult {
  const loaded = load(dir)
  if (!loaded.ok) return { ok: false, error: loaded.error }
  const before = loaded.file[name]
  if (typeof before !== "object" || before === null || Array.isArray(before)) {
    return { ok: false, error: `${ENGINES_FILE} 里没有 \`${name}\` 这一条了，可能刚被你手改过。重新打开这一页再试。` }
  }
  const kept = Object.fromEntries(
    Object.entries(before as Record<string, unknown>).filter(([key]) => !["label", "command", "args", "env", "registry"].includes(key)),
  )
  loaded.file[name] = { ...shapeOf(entry), ...kept }
  save(dir, loaded.file)
  return { ok: true, id: `acp:${name}` }
}

/** 删一条。**只删这一个键**，文件里其余的一字不动。 */
export function removeEngineEntry(dir: string, name: string): AddResult {
  const loaded = load(dir)
  if (!loaded.ok) return { ok: false, error: loaded.error }
  if (!Object.hasOwn(loaded.file, name)) return { ok: false, error: `${ENGINES_FILE} 里已经没有 \`${name}\` 了。` }
  Reflect.deleteProperty(loaded.file, name)
  save(dir, loaded.file)
  return { ok: true, id: `acp:${name}` }
}

/** 第一次打开时写进去的样板。**注释在 `_说明` 里**——JSON 没有注释。 */
const TEMPLATE = {
  _说明: [
    "这里注册讲 ACP（Agent Client Protocol）的第三方引擎。",
    "键是引擎 id，会以 acp: 前缀出现在界面上；值里的 command 是可执行文件。",
    "更省事的接法：设置 → 安装与接入，从 ACP 注册表里点「接入」，或者指一个可执行文件让它自己回答。",
    "手改这个文件之后去 设置 → 安装与接入 点「重新探测」：新加的当场可用，改过或删掉的只要没有会话在用也当场生效。",
    "正在被会话用着的那几家要等那些会话关掉（或重启 Switchback）——它们还握着旧的那份。",
    "下面 example 那一条是样板，删掉它或改成你真正装了的适配器。",
  ],
  example: {
    label: "示例（把这条删掉）",
    command: "codex-acp",
    args: [] as readonly string[],
    // 这两位 ACP 握手里问不出来，只能你告诉 Switchback；不填就是没有。
    // 只写真正对当前后端活体验证过的能力；桥里有路由不等于后端兑现
    compact: false,
    steer: false,
  },
} as const

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

/** 从命令名或标签推一个能当 JSON 键用的 id。**推不出来就返回 undefined**，别硬凑。 */
export function engineNameOf(raw: string): string | undefined {
  const base = raw.split(/[/\\]/).pop() ?? raw
  const id = base
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|sh|js|mjs)$/u, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
  // 下划线开头是注释键（见 `TEMPLATE._说明`），空的也不行
  return id === "" || id.startsWith("_") ? undefined : id
}
