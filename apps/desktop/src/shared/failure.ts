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

/**
 * 终态报错属于哪一类——**只用来给那张卡起个抬头**，原文照旧一字不少地摆在下面。
 *
 * 判据只认原文里明写的东西（HTTP 状态码、`usage limit`、`stream disconnected`
 * 这类引擎和服务商自己的措辞）。认不出就是 `other`，抬头退回一句笼统的「出错了」——
 * 宁可笼统，也不替引擎猜一个原因。
 *
 * **顺序有讲究**：额度排最前，有的家拿 403 / 429 报额度用完；
 * 服务端排在连接前面，`504 Gateway Time-out` 是对面的网关超时，不是你的网断了。
 */
export type FailureKind = "quota" | "rate" | "auth" | "server" | "network" | "other"

const KINDS: readonly (readonly [FailureKind, RegExp])[] = [
  ["quota", /usage limit|quota|insufficient[_ ]?(?:balance|credit)|credit balance|额度|余额不足/i],
  ["rate", /rate[ _-]?limit|too many requests|\b429\b/i],
  ["auth", /\b401\b|unauthori[sz]ed|not logged in|log ?in required|invalid[_ ]api[_ ]key|authentication (?:failed|required)|需要登录|未登录/i],
  ["server", /\b50[0234]\b|\b529\b|overloaded|internal server error|bad gateway|service unavailable/i],
  ["network", /stream disconnected|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|fetch failed|connection (?:error|reset|closed|refused)|network error|timed out|timeout|连接(?:断|中断)|超时/i],
]

export function failureKind(raw: string): FailureKind {
  for (const [kind, pattern] of KINDS) if (pattern.test(raw)) return kind
  return "other"
}

export const FAILURE_TITLE: Readonly<Record<FailureKind, string>> = {
  quota: "额度用完了",
  rate: "请求太频繁，被限流了",
  auth: "需要重新登录",
  server: "服务端出错了",
  network: "连接断了",
  other: "出错了",
}

/**
 * 少数几类，Switchback 自己手里就有下一步：额度和限流等不来的时候，换一家引擎接着做
 *（输入框左下角那个选择器就是）。别的类别不给建议——给不出靠得住的，就不说。
 */
export const FAILURE_HINT: Readonly<Partial<Record<FailureKind, string>>> = {
  quota: "等额度恢复，或者在输入框里换一家引擎接着做。",
  rate: "稍等片刻再试，或者在输入框里换一家引擎接着做。",
}
