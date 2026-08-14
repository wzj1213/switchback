import type { Normalized } from "./classify.js"
import { isInside } from "./path.js"
import type { Request, Rule, RulePattern } from "./types.js"

interface MatchInput {
  norm: Normalized
  req: Request
  pattern: RulePattern
}

function matchesTool({ req, pattern }: MatchInput): boolean {
  return pattern.tool === undefined || pattern.tool === req.tool
}

function matchesSignature({ norm, pattern }: MatchInput): boolean {
  if (pattern.commandSignature === undefined) return true
  if (norm.signatures.length === 0) return false
  // 所有命令段都要匹配——`pnpm test && rm -rf /` 不能因为第一段匹配就整体放行
  return norm.signatures.every((s) => s === pattern.commandSignature)
}

function matchesPath({ norm, pattern }: MatchInput): boolean {
  if (pattern.pathPrefix === undefined) return true
  if (norm.paths.length === 0) return false
  return norm.paths.every((p) => isInside(pattern.pathPrefix as string, p))
}

function matchesHost({ norm, pattern }: MatchInput): boolean {
  if (pattern.host === undefined) return true
  if (norm.hosts.length === 0) return false
  return norm.hosts.every((h) => h === pattern.host)
}

/**
 * 找出第一条匹配的记忆规则。
 *
 * 匹配语义是**全称的**：命令、路径、host 必须**全部**落在规则范围内才算命中。
 * 存在量词会让 `pnpm test && curl evil.com` 因为前半段匹配而整体放行。
 */
export function matchMemory(
  norm: Normalized,
  req: Request,
  rules: readonly Rule[],
): Rule | undefined {
  return rules.find((rule) => {
    const input: MatchInput = { norm, req, pattern: rule.pattern }
    return (
      matchesTool(input) && matchesSignature(input) && matchesPath(input) && matchesHost(input)
    )
  })
}

/** 为一次 escalate 生成「以后自动允许」的建议规则。判不出可记忆的模式时返回 undefined。 */
export function suggestRule(norm: Normalized): Rule | undefined {
  const firstSignature = norm.signatures[0]
  if (norm.category === "exec" && firstSignature !== undefined && norm.signatures.length === 1) {
    return {
      id: `sig:${firstSignature}`,
      describe: `自动允许 \`${firstSignature} …\``,
      pattern: { commandSignature: firstSignature },
      scope: "project",
    }
  }
  const firstHost = norm.hosts[0]
  if (norm.category === "net" && firstHost !== undefined && norm.hosts.length === 1) {
    return {
      id: `host:${firstHost}`,
      describe: `自动允许访问 ${firstHost}`,
      pattern: { host: firstHost },
      scope: "project",
    }
  }
  return undefined
}
