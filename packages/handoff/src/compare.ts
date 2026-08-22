import type { Item, Thread } from "@omni/protocol"
import type { Handoff } from "./build.js"

/**
 * 两次跑的对比。
 *
 * ## 为什么在这个包里
 *
 * 对比要回答「两家各自上报做了什么、差在哪」。`buildHandoff` 把一次跑压成结论
 * （动过哪些文件、跑过哪些命令、还剩什么），对比只是把两份结论并排放。
 *
 * 另写一套「对比专用的摘要」意味着同一件事有两个定义，迟早对不上：
 * 两套摘要说出不同数字时，用户不知道该信哪个。
 *
 * ## 只比结论，不比过程
 *
 * 不比 token 数、不比耗时、不比谁话多——那些是**代理指标**，
 * 看着客观其实误导：话少的那家可能只是没干活。
 * 文件部分只是编辑工具最后一次成功上报，**不是 Git 净 diff**；真实净差异由审核面板负责。
 */

export type Side = "a" | "b" | "both"

export interface FileDiff {
  path: string
  /** 只有一边动过时是 `a` 或 `b`——**这才是最值得看的一行**。 */
  side: Side
  a: { added: number; removed: number } | undefined
  b: { added: number; removed: number } | undefined
  /** 两边都动了但增删行数不一样。数字相同不代表内容相同，只是「值得点开看看」的信号弱一些。 */
  differs: boolean
}

export interface CommandDiff {
  command: string
  side: Side
}

export interface Comparison {
  files: readonly FileDiff[]
  commands: readonly CommandDiff[]
  /** 各自还剩什么没做。空数组是好消息，但**两边都空不代表两边都对**。 */
  open: { a: readonly string[]; b: readonly string[] }
  /** 各自最后说的话。并排读这两段，比读任何统计都快。 */
  last: { a: string | undefined; b: string | undefined }
  /** 只有一边动过的文件数。界面拿它决定要不要把对比条标红。 */
  onlyOneSide: number
}

/** 父子对比只取分叉点之后的父侧记录；分叉前缀是两边共有的，不是父侧独有。 */
export function comparisonItems(
  thread: Thread,
  peer: Thread,
  items: readonly Item[],
): readonly Item[] {
  if (peer.forkedFrom !== thread.id) return items
  const count = peer.forkedFromItemCount
  if (count === undefined || !Number.isInteger(count) || count < 0 || count > items.length) return items
  return items.slice(count)
}

function sideOf(inA: boolean, inB: boolean): Side {
  if (inA && inB) return "both"
  return inA ? "a" : "b"
}

function compareFiles(a: Handoff, b: Handoff): readonly FileDiff[] {
  const byPath = new Map<string, { a?: { added: number; removed: number }; b?: { added: number; removed: number } }>()
  for (const f of a.changed) byPath.set(f.path, { ...byPath.get(f.path), a: { added: f.added, removed: f.removed } })
  for (const f of b.changed) byPath.set(f.path, { ...byPath.get(f.path), b: { added: f.added, removed: f.removed } })
  return [...byPath.entries()]
    .map(([path, tally]) => ({
      path,
      side: sideOf(tally.a !== undefined, tally.b !== undefined),
      a: tally.a,
      b: tally.b,
      differs:
        tally.a !== undefined &&
        tally.b !== undefined &&
        (tally.a.added !== tally.b.added || tally.a.removed !== tally.b.removed),
    }))
    // 只有一边动过的排在最前：那是最需要人看一眼的
    .sort((x, y) => Number(x.side === "both") - Number(y.side === "both") || x.path.localeCompare(y.path))
}

function compareCommands(a: Handoff, b: Handoff): readonly CommandDiff[] {
  const inA = new Set(a.commands)
  const inB = new Set(b.commands)
  return [...new Set([...a.commands, ...b.commands])]
    .map((command) => ({ command, side: sideOf(inA.has(command), inB.has(command)) }))
    .sort((x, y) => Number(x.side === "both") - Number(y.side === "both") || x.command.localeCompare(y.command))
}

export function compareRuns(a: Handoff, b: Handoff): Comparison {
  const files = compareFiles(a, b)
  return {
    files,
    commands: compareCommands(a, b),
    open: { a: a.open, b: b.open },
    last: { a: a.last, b: b.last },
    onlyOneSide: files.filter((f) => f.side !== "both").length,
  }
}
