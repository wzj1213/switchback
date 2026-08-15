import type { ThreadRow } from "@omni/store"

/**
 * 侧栏筛选。
 *
 * ## 为什么需要它
 *
 * 会话只增不减。用真了一两周之后侧栏就是几十行 `tmp.xxx`、几十行同名目录，
 * 找上周那个会话只能一路滚。而这件事**没有别的入口**——会话不在文件管理器里、
 * 不在浏览器历史里，找不到就等于没有。
 *
 * ## 三个字段一起搜，多个词是「与」
 *
 * 人记得住的线索是不确定的：可能记得目录（`omni`）、可能记得当时问的第一句话
 * （`JSDoc`）、也可能记得标题。三个都搜，命中任意一个就算。
 *
 * 空格分开的多个词按**与**处理，且每个词可以命中不同字段——
 * 「omni JSDoc」应该找到「在 omni 目录里问 JSDoc 的那个」。
 * 按或处理的话，词加得越多结果越多，与人的直觉正好相反。
 */
export function filterRows(rows: readonly ThreadRow[], query: string): readonly ThreadRow[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t !== "")
  if (terms.length === 0) return rows
  return rows.filter((row) => {
    // 三个字段拼成一个大海捞针的干草堆。分开逐字段匹配的话，
    // 「omni JSDoc」这种跨字段的组合就搜不出来了
    const hay = `${row.thread.title}\n${row.preview ?? ""}\n${row.thread.cwd}`.toLowerCase()
    return terms.every((term) => hay.includes(term))
  })
}
