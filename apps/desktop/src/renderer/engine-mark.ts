import type { EngineSegment } from "@switchback/protocol"
import { isBuiltinEngine } from "../shared/builtin-engines.js"

/**
 * 「这一段归谁跑」——把 `Thread.segments` 翻成界面能用的两样东西：
 * **换手的那几个时刻**（转录区在那儿画一条分界）和
 * **某一刻归谁**（左缘导航按它给每一格上色）。
 *
 * ## 为什么不从 `Turn.engine` 算
 *
 * `Turn` 上确实写着这一轮由谁执行，但 store 只留**当前**那一轮
 *（见 `store/state.ts` 的 `turns`），跑完就摘掉了。要靠它回答「三小时前那一问
 * 是谁答的」，就得再存一份完成记录——而 `segments` 本来就是为这件事存的。
 *
 * ## 为什么颜色不写在组件里
 *
 * 五家引擎在这套界面里出现在三个地方（转录区分界、左缘导航、侧栏行）。
 * 三处各写一份色表的话，加第六家时必然漏掉一处，而漏掉的那处
 * 会安静地退回灰色——看起来像「这家没颜色」，不像「忘了加」。
 */

/** 这家引擎的那一抹颜色。第三方 ACP 引擎没有专属色，退到中性灰。 */
export function engineTint(engine: string): string {
  return isBuiltinEngine(engine) ? `var(--engine-${engine})` : "var(--engine-other)"
}

/** 一段：谁、什么时候接的手。 */
export interface EngineStint {
  engine: string
  profile?: string
  at: number
}

function sameHand(a: EngineSegment, b: EngineSegment): boolean {
  return a.engine === b.engine && a.profile === b.profile
}

function stintOf(segment: EngineSegment): EngineStint {
  return {
    engine: segment.engine,
    ...(segment.profile === undefined ? {} : { profile: segment.profile }),
    at: segment.startedAt,
  }
}

/**
 * **换手的那几个时刻**。第一段不算——它不是「切换到」，它是开场。
 *
 * 和上一段同一家同一 profile 的也不算：新宿主不会记出这种段
 *（见 `host/segment.ts`），但旧 journal 回放出来可能有，
 * 而在转录区连画两条「切换至 Codex」比不画更让人困惑。
 */
export function engineSwitches(segments: readonly EngineSegment[] = []): readonly EngineStint[] {
  return segments.flatMap((segment, index) => {
    const before = segments[index - 1]
    return before === undefined || sameHand(segment, before) ? [] : [stintOf(segment)]
  })
}

/**
 * 某一刻归谁跑：最后一个**不晚于它**的段。
 *
 * 段是在那一轮开始时落的（`host/prompt.ts` 的 `recordSegment` 排在
 * 发出 user_message 之前），所以同刻算作已经换过手了。
 * 比第一段还早的内容（接管进来的历史）没有归属，如实返回 undefined。
 */
export function engineAt(
  stints: readonly EngineStint[],
  at: number,
): EngineStint | undefined {
  return stints.findLast((stint) => stint.at <= at)
}

/** 全部段（含第一段）。`engineAt` 要的是这份，不是只有换手那几个。 */
export function engineStints(segments: readonly EngineSegment[] = []): readonly EngineStint[] {
  return segments.map(stintOf)
}
