import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ENGINES_FILE, type RegistrySource } from "./engines.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { ENGINES_FILE_TEXT } from "./engines-file.messages.js"

/**
 * 往 `engines.json` 里**写**的那几件事：加一条、换一条、删一条、第一次写样板。
 *
 * 从 `engines.ts` 拆出来是行数闸门逼的，但边界也对：那边是「读出来注册成驱动」，
 * 这里是「按人的指令改他的文件」——后者每一步都要守同一组规矩，放在一处才守得住。
 *
 * ## 三条规矩
 *
 * 1. **读原文、只改一个键、原样写回。** `readEngineFile` 会把文件规范化（丢掉 `_说明` 这类注释键、
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

function load(dir: string, locale: Locale): Loaded {
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
    return { ok: false, error: ENGINES_FILE_TEXT[locale].badJson(ENGINES_FILE) }
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: ENGINES_FILE_TEXT[locale].notObject(ENGINES_FILE) }
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
export function addEngineEntry(dir: string, name: string, entry: EntryInput, locale: Locale = DEFAULT_LOCALE): AddResult {
  const loaded = load(dir, locale)
  if (!loaded.ok) return { ok: false, error: loaded.error }
  if (Object.hasOwn(loaded.file, name)) return { ok: false, error: ENGINES_FILE_TEXT[locale].taken(ENGINES_FILE, name) }
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
export function replaceEngineEntry(dir: string, name: string, entry: EntryInput, locale: Locale = DEFAULT_LOCALE): AddResult {
  const loaded = load(dir, locale)
  if (!loaded.ok) return { ok: false, error: loaded.error }
  const before = loaded.file[name]
  if (typeof before !== "object" || before === null || Array.isArray(before)) {
    return { ok: false, error: ENGINES_FILE_TEXT[locale].vanished(ENGINES_FILE, name) }
  }
  const kept = Object.fromEntries(
    Object.entries(before as Record<string, unknown>).filter(([key]) => !["label", "command", "args", "env", "registry"].includes(key)),
  )
  loaded.file[name] = { ...shapeOf(entry), ...kept }
  save(dir, loaded.file)
  return { ok: true, id: `acp:${name}` }
}

/** 删一条。**只删这一个键**，文件里其余的一字不动。 */
export function removeEngineEntry(dir: string, name: string, locale: Locale = DEFAULT_LOCALE): AddResult {
  const loaded = load(dir, locale)
  if (!loaded.ok) return { ok: false, error: loaded.error }
  if (!Object.hasOwn(loaded.file, name)) return { ok: false, error: ENGINES_FILE_TEXT[locale].gone(ENGINES_FILE, name) }
  Reflect.deleteProperty(loaded.file, name)
  save(dir, loaded.file)
  return { ok: true, id: `acp:${name}` }
}

/** 样板里那条示例的其余字段。名字按界面语言另填（见 `templateOf`）。 */
const EXAMPLE = {
  command: "codex-acp",
  args: [] as readonly string[],
  // 这两位 ACP 握手里问不出来，只能你告诉 Switchback；不填就是没有。
  // 只写真正对当前后端活体验证过的能力；桥里有路由不等于后端兑现
  compact: false,
  steer: false,
} as const

/**
 * 第一次打开时写进去的样板，按当时的界面语言写。**注释在 `_说明`（英文版 `_notes`）里**——JSON 没有注释，
 * 而下划线开头的键 `readEngineFile` 一律跳过。
 */
function templateOf(locale: Locale): Record<string, unknown> {
  const m = ENGINES_FILE_TEXT[locale]
  return { [m.notesKey]: Object.values(m.notes), example: { label: m.exampleLabel, ...EXAMPLE } }
}

/**
 * 文件不存在就写一份样板出来。已存在**绝不覆盖**——那是用户的配置。
 * 返回路径，供菜单里「用编辑器打开」用。
 */
export function ensureEngineFile(dir: string, locale: Locale = DEFAULT_LOCALE): string {
  const path = join(dir, ENGINES_FILE)
  try {
    readFileSync(path, "utf8")
  } catch {
    writeFileSync(path, `${JSON.stringify(templateOf(locale), null, 2)}\n`, "utf8")
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
  // 下划线开头是注释键（见 `templateOf`），空的也不行
  return id === "" || id.startsWith("_") ? undefined : id
}
