import { engineAt, type EngineStint } from "./engine-mark.js"

/**
 * 转录区左缘那条大纲。
 *
 * ## 它回答的是「我问的第几件事在哪儿」
 *
 * 一条跑了两小时的会话有二三十轮，而滚动条只告诉你「大概在中间」——
 * 中间是哪一轮它不说。回到「我让它改数据库那次」的唯一办法是往回滚、
 * 一屏一屏认，认的还是**回答**（长、彼此相似），而你记得的是**自己那句话**。
 * 所以一格 = **你问的一次**，悬停给出那句话的原文，点一下跳过去。
 *
 * ## 为什么是一块波形，不是一把尺子
 *
 * 上一版把每格按它在整条会话里的深浅摆在整条高度上，粗细一律 2px——
 * 出来的东西像一把刻度尺：**均匀、机械、和这一屏别的任何东西都不像**。
 *
 * 这一版照 crew 那套（`internal/webui/static/app.js` 的 `miniWaveBins`）：
 *
 * - **每格的长短由那一轮的产出多少定**（`density`），再叠一条固定的节奏序列
 *   打散规整感——于是它读起来像一小片文字的缩影，而不是尺子上的齿。
 *   节奏序列是**定的不是随机的**：随机会让同一条会话每次渲染都换个样子。
 * - **聚成一块居中的短块**，格距最多 5.5px，不再铺满整条高度。位置只保留
 *   顺序，不再等比映射——两问的会话铺满一整屏高度时，那两格离得越远越
 *   说不出任何东西。
 * - **超过 32 格就并**：一格代表连着的几问，跳到其中第一问。三十几格再密下去
 *   就糊成一条实线了，那时它既不是波形也不是导航。
 *
 * 纯函数：没有 DOM、没有时钟，于是边界情形能用一张表穷举掉。
 */

/** 一格背后的那一问。`weight` 是这一轮产出的字数，决定这一格画多长。 */
export interface NavPoint {
  id: string
  text: string
  weight: number
  /**
   * 这一问归哪家引擎跑。**换过引擎的会话才有意义**——它让整条导航
   * 按颜色分成几段，「上面那五问是 codex 答的」一眼就看得出来。
   * 从 `Thread.segments` 按时刻查（见 `engine-mark.ts`），第一段之前的没有。
   */
  engine?: string
}

/** 算完之后的一格。 */
export interface RailMark {
  /** 这一格代表的那几问里的第一问——点它跳到那儿。 */
  id: string
  text: string
  /** 相对滚动可视区顶边的像素。 */
  y: number
  /** 这一格画多长（px）。 */
  width: number
  /** 这一格罩着哪几问。当下那一问落在其中就算这一格是当下。 */
  ids: readonly string[]
  /** 这一格代表的那一问归谁跑。并格时取头一问的——它就是这一格代表的那问。 */
  engine?: string
}

export interface RailBox {
  scrollHeight: number
  clientHeight: number
  scrollTop: number
}

/** 最多几格。再多就糊成一条实线，既不是波形也不是导航。 */
const BINS = 32
/** 格距上限。挤到这个数以内才是「一块」，散开就成了尺子。 */
const GAP = 5.5
/** 上下各留出去的余量，块永远落在中间那一段里。 */
const INSET = 16
/** 最短、最长的一格。 */
const MIN_W = 5
const MAX_W = 20
/**
 * 节奏。**定的，不是随机的**——随机会让同一条会话每次渲染都换个样子，
 * 而这块东西是这条会话的"指纹"，它该是稳定的。数列本身没有含义，
 * 只是一串错落的数，用来打散「产出多少」算出来的那条平滑曲线。
 */
const RHYTHM = [0, 3, 1, 7, 2, 5, 1, 8, 4, 6, 2, 5] as const

/**
 * 短于这个数就不画。
 *
 * 内容比可视区高不了多少时，导航条上每一格都指向「几乎同一个位置」——
 * 那时它不是导航，是装饰。**滚不动就没有「我在哪儿」这个问题。**
 */
const MIN_OVERFLOW = 120

/** 这一格画多长：产出越多越长，再叠一档节奏。 */
export function widthOf(weight: number, at: number): number {
  const density = Math.min(1, Math.log1p(Math.max(0, weight)) / Math.log(420))
  const beat = RHYTHM[at % RHYTHM.length] ?? 0
  return Math.round(Math.min(MAX_W, MIN_W + density * 7 + beat * 0.78))
}

/** 把 n 问并成最多 `BINS` 格。一格罩着连着的几问，代表的是其中第一问。 */
function binned(points: readonly NavPoint[]): readonly (NavPoint & { ids: string[] })[] {
  const count = Math.min(BINS, points.length)
  const out: (NavPoint & { ids: string[] })[] = []
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * points.length) / count)
    const to = Math.floor(((i + 1) * points.length) / count)
    const group = points.slice(from, Math.max(to, from + 1))
    const head = group[0]
    if (head === undefined) continue
    out.push({
      ...head,
      weight: group.reduce((sum, one) => sum + one.weight, 0),
      ids: group.map((one) => one.id),
    })
  }
  return out
}

export function railLayout(
  points: readonly (NavPoint & { top: number })[],
  box: RailBox,
): { marks: readonly RailMark[]; activeId: string | undefined } {
  if (points.length < 2 || box.scrollHeight - box.clientHeight < MIN_OVERFLOW) {
    return { marks: [], activeId: undefined }
  }
  const bins = binned(points)
  const room = Math.max(0, box.clientHeight - 2 * INSET)
  const gap = bins.length > 1 ? Math.min(GAP, room / (bins.length - 1)) : 0
  const block = (bins.length - 1) * gap
  const top = Math.max(INSET, Math.round((box.clientHeight - block) / 2))
  const marks = bins.map((bin, at) => ({
    id: bin.id,
    text: bin.text,
    ids: bin.ids,
    y: Math.round(top + at * gap),
    width: widthOf(bin.weight, at),
    ...(bin.engine === undefined ? {} : { engine: bin.engine }),
  }))
  // 当下读到哪一问：视线上沿再往下一点点算「正在读」，滚到底时一定是最后一问
  const line = box.scrollTop + box.clientHeight * 0.2
  const bottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 2
  const at = bottom ? points.length - 1 : points.findLastIndex((point) => point.top <= line)
  const now = points[at < 0 ? 0 : at]?.id
  // 那一问被并进了哪一格，就算哪一格是当下
  return { marks, activeId: marks.find((mark) => mark.ids.includes(now ?? ""))?.id }
}

/** 悬停卡里那两行：第一行是标题，其余压成一段。 */
export function railPeek(text: string): { title: string; body: string } {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line !== "")
  const title = lines[0] ?? ""
  return { title, body: lines.slice(1).join(" ") }
}

/**
 * 哪些行是大纲上的一格，以及那一轮产出了多少字。
 *
 * 接力带过来的（`origin` 有值）不算一格——那不是你在这条会话里问的
 *（同 `lastMine` 那条判据）。**字数按轮累计**：一格画多长读的是
 * 「那一轮干了多少」，而不是「你那句话有多长」——你那句常常是三个字。
 */
export function navPointsOf(
  rows: readonly {
    kind: string
    item?: { id: string; kind: string; text?: string; turnId?: string; origin?: unknown; at?: number }
    items?: readonly { turnId?: string; tool?: string }[]
  }[],
  /** 这条会话的分段。给了才给每一格标上引擎；没换过引擎的会话不用传。 */
  stints: readonly EngineStint[] = [],
): readonly NavPoint[] {
  const weight = new Map<string, number>()
  const add = (turnId: string | undefined, n: number): void => {
    if (turnId === undefined) return
    weight.set(turnId, (weight.get(turnId) ?? 0) + n)
  }
  for (const row of rows) {
    if (row.kind === "item") add(row.item?.turnId, (row.item?.text ?? "").length)
    // 工具行也算产出：一轮跑了二十个命令、一个字没说，那一格不该是最短的
    if (row.kind === "run") for (const one of row.items ?? []) add(one.turnId, 24)
  }
  return rows.flatMap((row) => {
    const item = row.item
    if (row.kind !== "item" || item?.kind !== "user_message" || item.origin !== undefined) return []
    const engine = engineAt(stints, item.at ?? 0)?.engine
    return [{
      id: item.id,
      text: item.text ?? "",
      weight: weight.get(item.turnId ?? "") ?? 0,
      ...(engine === undefined ? {} : { engine }),
    }]
  })
}
