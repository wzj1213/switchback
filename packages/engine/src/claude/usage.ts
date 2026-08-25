export interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

const num = (value: unknown): number => (typeof value === "number" ? value : 0)

/**
 * Claude 的用量。
 *
 * 上下文占用 = 这次请求送上去的输入（含缓存命中的那部分）+ 产出。
 * **缓存命中必须算进去**——它省的是钱，不是上下文：那些 token 照样占窗口。
 *
 * 窗口大小不在结果帧里，由会话用 `getContextUsage()` 另取后随本次用量一起送出。
 * `cacheRead` 只取 cache_read（命中）；cache_creation 是写缓存，不是命中。
 */
export function claudeUsage(
  raw: RawUsage,
  contextWindow?: number,
): { contextUsed: number; contextWindow?: number; outputTokens?: number; cacheRead?: number } {
  return {
    contextUsed:
      num(raw.input_tokens) +
      num(raw.cache_read_input_tokens) +
      num(raw.cache_creation_input_tokens) +
      num(raw.output_tokens),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(typeof raw.output_tokens === "number" ? { outputTokens: raw.output_tokens } : {}),
    ...(typeof raw.cache_read_input_tokens === "number"
      ? { cacheRead: raw.cache_read_input_tokens }
      : {}),
  }
}
