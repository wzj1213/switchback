import type { UserMessageItem } from "@switchback/protocol"
import type { Row } from "./group.js"

/**
 * 换引擎时那段交接说明，收进「切换至 X」那条分界线。
 *
 * 它原样发给了新引擎，转录区也得照实留着（见 `AGENTS.md`「换引擎自动交接」）。
 * 但它不是谁说的话，摊成一大块卡片就喧宾夺主——分界线上挂一个「附交接说明」，
 * 点开才是原文，一字不改。
 *
 * 只收**紧挨着**分界线的那一条（前后都算：分界的时刻与说明发出的时刻谁先谁后不定）。
 * 隔着别的行就不收，照常画成一条消息——宁可丑一点，也不把它挪离它真实的位置。
 */
export function withHandoffBriefs(rows: readonly Row[]): readonly Row[] {
  const out: Row[] = []
  for (const row of rows) {
    const prev = out[out.length - 1]
    const brief = briefOf(row)
    if (brief !== undefined && prev?.kind === "engine" && prev.brief === undefined) {
      out[out.length - 1] = { ...prev, brief }
      continue
    }
    const before = prev === undefined ? undefined : briefOf(prev)
    if (row.kind === "engine" && row.brief === undefined && before !== undefined) {
      out[out.length - 1] = { ...row, brief: before }
      continue
    }
    out.push(row)
  }
  return out
}

function briefOf(row: Row): UserMessageItem | undefined {
  if (row.kind !== "item" || row.item.kind !== "user_message") return undefined
  return row.item.origin === "handoff" ? row.item : undefined
}
