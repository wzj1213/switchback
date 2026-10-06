export interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/** Claude 控制通道给出的当前上下文快照。它是占用量的权威来源。 */
export interface ContextSnapshot {
  totalTokens: number
  maxTokens: number
}

interface UsageOptions {
  context?: ContextSnapshot
  latest?: RawUsage
  /** steer 会把一个 Switchback 回合切成几段原生结果；生成量要把那些段相加。 */
  outputTokens?: number
}

interface UsageReport {
  contextUsed: number
  contextWindow?: number
  outputTokens?: number
  cacheRead?: number
}

const num = (value: unknown): number => (typeof value === "number" ? value : 0)

/**
 * Claude 的用量。三种原生数字不能混：
 *
 * - `result.usage` 是一条用户提示触发的**整轮汇总**；一轮里多次请求时会重复累计输入；
 * - assistant 的 `message.usage` 是最近一次模型请求，可作旧 CLI 的占用兜底；
 * - `getContextUsage()` 的 `totalTokens` 是此刻真正装在窗口里的量，拿得到就只认它。
 *
 * 缓存命中省的是钱，不是上下文；兜底相加时仍必须算进去。
 */
export function claudeUsage(
  raw: RawUsage,
  options: UsageOptions = {},
): UsageReport {
  const recent = options.latest ?? raw
  const outputTokens = options.outputTokens ?? raw.output_tokens
  const report: UsageReport = { contextUsed: contextUsedOf(options.context, recent) }
  if (validWindow(options.context)) report.contextWindow = options.context.maxTokens
  if (outputTokens !== undefined) report.outputTokens = outputTokens
  if (typeof recent.cache_read_input_tokens === "number") report.cacheRead = recent.cache_read_input_tokens
  return report
}

function contextUsedOf(context: ContextSnapshot | undefined, recent: RawUsage): number {
  return valid(context?.totalTokens) ? context.totalTokens : tokensOf(recent)
}

function validWindow(context: ContextSnapshot | undefined): context is ContextSnapshot {
  return valid(context?.maxTokens) && context.maxTokens > 0
}

/** 最近一次请求占了多少；仅在控制通道没有快照时用。 */
function tokensOf(raw: RawUsage): number {
  return num(raw.input_tokens) + num(raw.cache_read_input_tokens) +
    num(raw.cache_creation_input_tokens) + num(raw.output_tokens)
}

const valid = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0

/** 把 steer 前后几段的生成量合成这一个 Switchback 回合的真分子。 */
export function addOutputTokens(total: number | undefined, raw: RawUsage | undefined): number | undefined {
  if (typeof raw?.output_tokens !== "number") return total
  return (total ?? 0) + raw.output_tokens
}
