import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * 审批记忆的落盘。
 *
 * 和事件日志分开存，因为它们的生命周期完全不同：事件是**某一次会话**的流水，
 * 规则是**某个工作区**的长期设置。会话删了规则还在，这正是用户勾「始终允许」时
 * 期待的行为。
 */

/**
 * 和 `@omni/approval` 的 `Rule` 结构一致。
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

function parse(text: string): StoredRule[] {
  try {
    const value: unknown = JSON.parse(text)
    if (!Array.isArray(value)) return []
    return (value as StoredRule[]).filter((r) => typeof r.id === "string" && typeof r.describe === "string")
  } catch {
    // 文件坏了就当没有规则。**不能当成"全部允许"**，也不该让会话起不来。
    return []
  }
}

export function createRuleStore(dir: string): RuleStore {
  const ready = mkdir(dir, { recursive: true }).then(
    () => true,
    () => false,
  )
  const pathOf = (worksite: string): string => join(dir, keyOf(worksite))

  const read = async (worksite: string): Promise<readonly StoredRule[]> => {
    const text = await readFile(pathOf(worksite), "utf8").catch(() => "")
    return text === "" ? [] : parse(text)
  }

  const save = async (worksite: string, rules: readonly StoredRule[]): Promise<void> => {
    if (!(await ready)) return
    await writeFile(pathOf(worksite), JSON.stringify(rules, null, 2), "utf8").catch(() => undefined)
  }

  return {
    read,
    add: async (worksite, rule) => {
      const kept = (await read(worksite)).filter((r) => r.id !== rule.id)
      const next = [...kept, rule]
      await save(worksite, next)
      return next
    },
    remove: async (worksite, ruleId) => {
      const next = (await read(worksite)).filter((r) => r.id !== ruleId)
      await save(worksite, next)
      return next
    },
  }
}
