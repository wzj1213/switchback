import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * 审批记忆的落盘。
 *
 * 和事件日志分开存，因为它们的生命周期完全不同：事件是**某一次会话**的流水，
 * 规则是**某个工作区**的长期设置。会话删了规则还在，这正是用户勾「始终允许」时
 * 期待的行为。
 */

/**
 * 和 `@switchback/approval` 的 `Rule` 结构一致。
 *
 * **不 import 那个包**——它和本包同层，架构守卫不允许同层互相依赖。
 * `pattern` 声明成宽松的记录：本包不解释规则内容，只负责它的字节进出。
 */
export interface StoredRule {
  id: string
  describe: string
  pattern: Readonly<Record<string, unknown>>
  scope: string
}

/**
 * 工作区路径 → 文件名。
 *
 * 用哈希而不是把路径转义进文件名：路径可以很长、可以带中文和空格，
 * 转义规则一旦要改，旧文件就全都读不出来了。哈希是定长且稳定的。
 * 前缀留一段可读的目录名，纯粹为了人肉排查时认得出是哪个工作区。
 */
export function keyOf(worksite: string): string {
  const digest = createHash("sha256").update(worksite).digest("hex").slice(0, 16)
  const tail = (worksite.split("/").filter(Boolean).pop() ?? "root").replace(/[^A-Za-z0-9._-]/g, "")
  return `${tail === "" ? "ws" : tail}-${digest}.json`
}

export interface RuleStore {
  read: (worksite: string) => Promise<readonly StoredRule[]>
  /** 追加一条并去重（按 id）。返回写完之后的全量。 */
  add: (worksite: string, rule: StoredRule) => Promise<readonly StoredRule[]>
  remove: (worksite: string, ruleId: string) => Promise<readonly StoredRule[]>
}

const PATTERN_KEYS = ["tool", "commandSignature", "pathPrefix", "host"] as const

function objectOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as Readonly<Record<string, unknown>>
}

const nonempty = (value: unknown): value is string => typeof value === "string" && value !== ""

function ruleOf(value: unknown): StoredRule | undefined {
  const item = objectOf(value)
  if (item === undefined) return undefined
  if (!nonempty(item["id"])) return undefined
  if (typeof item["describe"] !== "string") return undefined
  if (item["scope"] !== "project") return undefined
  const raw = objectOf(item["pattern"])
  if (raw === undefined) return undefined
  if (Object.keys(raw).some((key) => !PATTERN_KEYS.includes(key as typeof PATTERN_KEYS[number]))) return undefined
  const pattern: Record<string, string> = {}
  for (const key of PATTERN_KEYS) {
    const field = raw[key]
    if (field === undefined) continue
    if (typeof field !== "string" || field === "") return undefined
    pattern[key] = field
  }
  if (Object.keys(pattern).length === 0) return undefined
  return { id: item["id"], describe: item["describe"], pattern, scope: "project" }
}

function parse(text: string): StoredRule[] {
  try {
    const value: unknown = JSON.parse(text)
    if (!Array.isArray(value)) return []
    return value.flatMap((item) => {
      const rule = ruleOf(item)
      return rule === undefined ? [] : [rule]
    })
  } catch {
    // 文件坏了就当没有规则。**不能当成"全部允许"**，也不该让会话起不来。
    return []
  }
}

type RuleChain = Map<string, Promise<readonly StoredRule[]>>

/** 同一工作区的读改写必须串行；不同工作区仍可并行。 */
function enqueue(chains: RuleChain, key: string, run: () => Promise<readonly StoredRule[]>): Promise<readonly StoredRule[]> {
  const previous = chains.get(key) ?? Promise.resolve([])
  const next = previous.catch(() => []).then(run)
  chains.set(key, next)
  void next.then(() => {
    if (chains.get(key) === next) chains.delete(key)
  })
  return next
}

export function createRuleStore(dir: string): RuleStore {
  const ready = mkdir(dir, { recursive: true }).then(
    () => true,
    () => false,
  )
  const pathOf = (worksite: string): string => join(dir, keyOf(worksite))
  const chains: RuleChain = new Map()

  const load = async (worksite: string): Promise<readonly StoredRule[]> => {
    const text = await readFile(pathOf(worksite), "utf8").catch(() => "")
    return text === "" ? [] : parse(text)
  }

  const read = async (worksite: string): Promise<readonly StoredRule[]> => {
    await chains.get(pathOf(worksite))?.catch(() => undefined)
    return load(worksite)
  }

  const save = async (worksite: string, rules: readonly StoredRule[]): Promise<void> => {
    if (!(await ready)) return
    const path = pathOf(worksite)
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(rules, null, 2), "utf8")
      await rename(temporary, path)
    } catch {
      // 审批记忆失败不能掐断正在运行的工具请求；旧文件仍保持完整
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  const mutate = (
    worksite: string,
    update: (before: readonly StoredRule[]) => readonly StoredRule[],
  ): Promise<readonly StoredRule[]> => enqueue(chains, pathOf(worksite), async () => {
    const next = update(await load(worksite))
    await save(worksite, next)
    return next
  })

  return {
    read,
    add: (worksite, rule) => mutate(worksite, (before) => [...before.filter((r) => r.id !== rule.id), rule]),
    remove: (worksite, ruleId) => mutate(worksite, (before) => before.filter((r) => r.id !== ruleId)),
  }
}
