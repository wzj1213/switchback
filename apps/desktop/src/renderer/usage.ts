import type { Usage } from "@omni/protocol"

/** 超过这个占比开始提醒；再高就是危险区。 */
const WARN_AT = 0.7
const DANGER_AT = 0.9

export type UsageLevel = "ok" | "warn" | "danger"

export function level(ratio: number): UsageLevel {
  if (ratio >= DANGER_AT) return "danger"
  if (ratio >= WARN_AT) return "warn"
  return "ok"
}

/**
 * token 数的紧凑写法。
 *
 * 界面上是一个角落里的小标签，`258400` 这种数字既占地方又不好读；
 * `258k` 一眼就能和窗口大小比出比例。1000 以下保留原样——
 * 会话刚开始时看到 `0k` 会让人以为它没在工作。
 */
export function compact(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  const k = tokens / 1000
  return k < 100 ? `${k.toFixed(1).replace(/\.0$/, "")}k` : `${String(Math.round(k))}k`
}

export interface Meter {
  /**
   * 顶栏上**唯一**常驻的那个数。
   *
   * ## 为什么只留一个
   *
   * 上一版这里同时挂着四段：`369k / 1049k · 35%`、`累计 50826k`、`缓存 50115k`。
   * 三十多个字符的数字压在顶栏右上角，没有分组、没有主次——**眼睛在上面没有落点**，
   * 于是那一整块既不会被读，又一直在占注意力。
   *
   * 它们都是真数，也都有用，但**不是同一个层级的东西**：
   * 「离上限还有多远」是你一直在扫的，「这一轮花了多少」是你想起来才查的。
   * 把想起来才查的那些常驻在这儿，等于让每一眼都替一个偶尔的问题付钱。
   * 所以常驻只留比例，其余进 `title`。
   */
  label: string
  /** 0–1；引擎没给窗口大小时是 undefined，界面上就不画进度条。 */
  ratio: number | undefined
  /** 本会话累计——**单独一段**，它是账单，不是「离上限还有多远」。 */
  total: string | undefined
  /**
   * 最近一次请求命中缓存读到的 token——**单独一段**，报了才显示。
   * 它回答「刚才那下贵不贵」：命中率从九成掉到零，一定是有东西把前缀缓存打掉了。
   */
  cache: string | undefined
  level: UsageLevel
  title: string
}

/**
 * 用量 → 一个可渲染的表。
 *
 * **窗口大小缺席时不画进度条**，只显示数字。照一个猜出来的分母画出来的比例，
 * 比没有比例更糟——它会让人在还早的时候就以为快满了，或者反过来。
 *
 * 百分比直接写进 label：分母是恒定的，让眼睛读两个数去得出比例，
 * 不如直接把比例写出来——那正是这个控件唯一想说的话。
 */
export function meterOf(usage: Usage | undefined): Meter | undefined {
  if (usage === undefined) return undefined
  const { contextUsed, contextWindow, totalTokens, cacheRead } = usage
  const total = totalTokens === undefined ? undefined : `累计 ${compact(totalTokens)}`
  const cache = cacheRead === undefined ? undefined : `缓存 ${compact(cacheRead)}`
  const bill = `${totalTokens === undefined ? "" : ` · 本会话累计 ${compact(totalTokens)}`}${cacheRead === undefined ? "" : ` · 缓存命中 ${compact(cacheRead)}`}`
  if (contextWindow === undefined || contextWindow <= 0) {
    return {
      label: `${compact(contextUsed)} tokens`,
      ratio: undefined,
      total,
      cache,
      level: "ok",
      title: `上下文占用 ${String(contextUsed)} tokens（引擎未提供窗口大小）${bill}`,
    }
  }
  const ratio = Math.min(1, contextUsed / contextWindow)
  const pct = `${String(Math.round(ratio * 100))}%`
  return {
    label: pct,
    ratio,
    total,
    cache,
    level: level(ratio),
    title: `上下文 ${compact(contextUsed)} / ${compact(contextWindow)} · ${pct}${bill}`,
  }
}
