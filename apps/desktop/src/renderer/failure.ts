/**
 * 把引擎吐出来的报错翻成人话。
 *
 * ## 为什么需要这一层
 *
 * 引擎报错的形状五花八门，而它们**原样贴出来都是同一个效果：一堵墙**。
 * 实测收到过这两种——
 *
 *     {"type":"error","status":400,"error":{"type":"invalid_request_error",
 *      "message":"The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account."}}
 *
 *     Claude Code returned an error result: [ede_diagnostic] result_type=user
 *     last_content_type=n/a stop_reason=tool_use
 *
 * 第一条里真正在说事的只有那句 `message`，外面三层 JSON 是传输格式；
 * 第二条里 `[ede_diagnostic] result_type=…` 是给引擎作者排查用的，不是给用户的。
 *
 * ## 但原文不能丢
 *
 * 翻译总有翻不准的时候，而报错正是**最不能自作主张**的地方——
 * 用户拿这段话去搜、去开 issue、去问引擎作者。所以这里只负责挑出
 * 「哪一句是给人看的」，原文由调用方折叠起来一并保留。
 */

/** 一眼能看出是 JSON 的才尝试解析——`JSON.parse` 对普通句子会抛，白试一遍。 */
function asJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

/** 从任意深度的对象里捞第一个 `message` 字符串。各家嵌套层数不一样，写死路径会漏。 */
function deepMessage(value: unknown, depth = 0): string | undefined {
  if (depth > 6 || value === null || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const own = record["message"]
  if (typeof own === "string" && own.trim() !== "") return own.trim()
  for (const child of Object.values(record)) {
    const found = deepMessage(child, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

/** `[ede_diagnostic] result_type=user last_content_type=n/a` 这类给引擎作者看的尾巴。 */
const DIAGNOSTIC = /\s*\[[a-z_]+\]\s*(?:[a-z_]+=\S*\s*)+$/i

export interface Failure {
  /** 给人看的那一句。 */
  text: string
  /** 原文和它不一样时，界面要留一个「详情」把原文折进去。 */
  detailed: boolean
}

export function humanize(raw: string): Failure {
  const message = deepMessage(asJson(raw))
  if (message !== undefined) return { text: message, detailed: message !== raw.trim() }

  const stripped = raw.replace(DIAGNOSTIC, "").trim()
  if (stripped !== "" && stripped !== raw.trim()) return { text: stripped, detailed: true }

  // 认不出的形状**原样显示**。这里宁可难看，也不要把唯一的线索藏起来
  return { text: raw.trim(), detailed: false }
}
