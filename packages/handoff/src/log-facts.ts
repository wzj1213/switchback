/**
 * 一份引擎原始记录**实际长什么样**：从文件内容里读出来的事实，不是 Switchback 写的格式说明。
 *
 * ## 为什么不写「各家日志格式说明」
 *
 * 各家的会话文件是私有格式，改了不会通知谁。Switchback 要是维护一份说明，
 * 哪天厂商一改，模型就照着过时的说明去 grep——看到的是 Switchback 在撒谎。
 * 这里只报这一份文件此刻的事实：是不是 JSONL、多少行、`type` 有哪些取值各几条、
 * 已知的原生 id 落在哪个字段。接手的那家拿着这些直接搜，不用先摸索结构。
 */
export interface LogFacts {
  format: "jsonl" | "json" | "text"
  lines: number
  /** JSONL 每行顶层 `type` 的取值与条数，按条数降序；没有这个字段就是空的。 */
  types: readonly (readonly [string, number])[]
  /** 已知的原生 id 在这份记录里出现在哪个字段，例如 `message.content[].id`。 */
  idPath?: string
  /** 用来定位的那个 id。 */
  idSample?: string
  /** 每行的时间戳在哪个字段（值是 ISO 8601 的那个），例如 `timestamp`。找不到 id 时按时间对位。 */
  timePath?: string
}

function parse(line: string): unknown {
  try {
    return JSON.parse(line) as unknown
  } catch {
    return undefined
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 在一棵 JSON 里找值恰好等于 `needle` 的字段，返回它的路径；数组下标写成 `[]`。 */
export function pathOf(value: unknown, needle: string, at = ""): string | undefined {
  if (value === needle) return at === "" ? "(整行)" : at
  if (Array.isArray(value)) {
    for (const child of value) {
      const hit = pathOf(child, needle, `${at}[]`)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (!isObject(value)) return undefined
  for (const [key, child] of Object.entries(value)) {
    const hit = pathOf(child, needle, at === "" ? key : `${at}.${key}`)
    if (hit !== undefined) return hit
  }
  return undefined
}

function countTypes(rows: readonly unknown[]): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (!isObject(row) || typeof row["type"] !== "string") continue
    counts.set(row["type"], (counts.get(row["type"]) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1])
}

/** `index` 所在的那一行。 */
function lineAt(content: string, index: number): string {
  const start = content.lastIndexOf("\n", index) + 1
  const end = content.indexOf("\n", index)
  return content.slice(start, end === -1 ? undefined : end)
}

/**
 * 已知 id 里第一个在记录中找得到的：返回它和它所在的字段路径。
 *
 * 在整段文本上 `indexOf`，不逐行 `includes`：原始记录动辄几十 MB，
 * 而 Switchback 自己铸的 id 在里面根本搜不到——逐行找的话，每个找不到的 id 都是一遍全量扫描。
 */
function locate(content: string, ids: readonly string[], whole: boolean): Pick<LogFacts, "idPath" | "idSample"> {
  for (const id of ids) {
    const index = id === "" ? -1 : content.indexOf(id)
    if (index === -1) continue
    const path = pathOf(parse(whole ? content : lineAt(content, index)), id)
    if (path !== undefined) return { idPath: path, idSample: id }
  }
  return {}
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

function isoKey(record: Record<string, unknown>): string | undefined {
  return Object.entries(record).find(([, value]) => typeof value === "string" && ISO.test(value))?.[0]
}

/** 顶层或下一层里值为 ISO 时间的字段。 */
function timeFieldOf(row: unknown): string | undefined {
  if (!isObject(row)) return undefined
  const top = isoKey(row)
  if (top !== undefined) return top
  for (const [key, value] of Object.entries(row)) {
    const inner = isObject(value) ? isoKey(value) : undefined
    if (inner !== undefined) return `${key}.${inner}`
  }
  return undefined
}

/** 前 20 行里至少一半都有的那个时间字段才算：零星一两行带时间的不足以拿来对位。 */
function timePathOf(rows: readonly unknown[]): Pick<LogFacts, "timePath"> {
  const sample = rows.slice(0, 20).filter((row) => row !== undefined)
  const counts = new Map<string, number>()
  for (const row of sample) {
    const path = timeFieldOf(row)
    if (path !== undefined) counts.set(path, (counts.get(path) ?? 0) + 1)
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]
  return best !== undefined && best[1] * 2 >= sample.length ? { timePath: best[0] } : {}
}

export function logFacts(content: string, ids: readonly string[]): LogFacts {
  const lines = content.split("\n").filter((line) => line.trim() !== "")
  const rows = lines.map(parse)
  // 引擎可能正写到一半：只有最后一行是半截很常见；另外零星几行坏了也不改判（九成以上是 JSON）
  const parsed = rows.filter((row) => row !== undefined).length
  const tailOnly = lines.length > 1 && parsed === lines.length - 1 && rows[rows.length - 1] === undefined
  const jsonl = lines.length > 0 && (tailOnly || parsed / lines.length >= 0.9)
  if (jsonl) {
    return { format: "jsonl", lines: lines.length, types: countTypes(rows), ...locate(content, ids, false), ...timePathOf(rows) }
  }
  const format = parse(content) === undefined ? "text" : "json"
  return { format, lines: lines.length, types: [], ...(format === "json" ? locate(content, ids, true) : {}) }
}
