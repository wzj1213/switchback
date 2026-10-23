import type { RateLimits, RateWindow } from "@switchback/protocol"
import type { Locale } from "@switchback/i18n"
import { LIMITS } from "./limits.messages.js"

type Text = (typeof LIMITS)[Locale]

/**
 * 额度还剩多少，要不要出声。
 *
 * ## 为什么不是一直显示
 *
 * 额度是一个**平时完全不需要知道**的数字。一直摆一根进度条在那儿，
 * 它每轮都动，而 99% 的时间它说的是「你还早着呢」——那是纯噪声，
 * 看久了人就不看了，等到真该看的时候也不会看。
 *
 * 所以只在**接近用完**时出声。阈值取 75%：低于它没有任何行动可做，
 * 高于它你可能想换个模型、或者把手上这件事先做完再开新的。
 *
 * codex 自己也是这么做的（读它的实现：低于阈值直接 `return null`）。
 *
 * ## 为什么取「更紧的那个」而不是数值更大的
 *
 * 两个窗口一般是「本周」和「最近 5 小时」。周用了 80%、5 小时用了 30%，
 * 该说的是周；反过来 5 小时用了 95%、周用了 40%，该说的是 5 小时——
 * **它更快撞墙，也更快恢复**。同数时窗口短的优先，因为它更近在眼前。
 */
const SPEAK_ABOVE = 75

export interface LimitNotice {
  /** 0–100，可能超过 100。 */
  percent: number
  /** 「本周」「最近 5 小时」这种人话。窗口长度报不上来时是 undefined。 */
  window?: string
  /** 已经打满了——那时该说的是「停了」而不是「快满了」。 */
  blocked: boolean
  /**
   * 什么时候恢复，人话（「8月20日 11:29」）。报不上来就缺席。
   *
   * **只在打满时才有意义**：没满的时候你根本不需要知道窗口什么时候滚动，
   * 满了的时候这是唯一有行动意义的信息——是等一会儿，还是换个引擎干活。
   */
  resetsAt?: string
}

export function limitNotice(limits: RateLimits | undefined, locale: Locale): LimitNotice | undefined {
  const m = LIMITS[locale]
  const pick = urgent(limits?.primary, limits?.secondary)
  if (pick === undefined || pick.usedPercent < SPEAK_ABOVE) return undefined
  const window = describeWindow(pick.windowDurationMins, m)
  const blocked = pick.usedPercent >= 100
  const resets = blocked ? describeReset(pick.resetsAt, m) : undefined
  return {
    percent: Math.round(pick.usedPercent),
    ...(window === undefined ? {} : { window }),
    blocked,
    ...(resets === undefined ? {} : { resetsAt: resets }),
  }
}

/**
 * 重置时刻说成人话。
 *
 * 用本机时区显示，不显示时区名——codex 自己按美东渲染那串
 * 「try again at Aug 19th, 2026 11:29 PM」，对一个在东八区的人是错的。
 * **同一时刻用你自己的钟表述，才是可以照着行动的。**
 *
 * 解析不出来就缺席：说错一个恢复时间比不说糟得多。
 */
function describeReset(iso: string | undefined, m: Text): string | undefined {
  if (iso === undefined) return undefined
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return undefined
  return m.reset(at.getTime())
}

/** 谁更紧：百分比高的；同高则窗口短的（它更近在眼前）。 */
function urgent(a: RateWindow | undefined, b: RateWindow | undefined): RateWindow | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  if (b.usedPercent > a.usedPercent) return b
  if (a.usedPercent > b.usedPercent) return a
  return (b.windowDurationMins ?? Infinity) < (a.windowDurationMins ?? Infinity) ? b : a
}

/**
 * 分钟数说成人话。
 *
 * **不做成「1440 分钟」那种字面翻译**——人对「本周」有感觉，对「10080 分钟」没有。
 * 认不出的时长就不说，只报百分比：说错一个时间窗比不说更糟。
 */
function describeWindow(mins: number | undefined, m: Text): string | undefined {
  if (mins === undefined || mins <= 0) return undefined
  if (mins < 60) return m.minutes(mins)
  if (mins < 60 * 24) return m.hours(Math.round(mins / 60))
  if (mins >= 60 * 24 * 6 && mins <= 60 * 24 * 8) return m.week
  return m.days(Math.round(mins / (60 * 24)))
}
