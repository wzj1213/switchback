/**
 * 转录区左边那条导航。
 *
 * ## 它回答的是「我问的第几件事在哪儿」
 *
 * 一条跑了两小时的会话有二三十轮，而滚动条只告诉你「大概在中间」——
 * 中间是哪一轮它不说。回到「我让它改数据库那次」的唯一办法是往回滚、
 * 一屏一屏认，认的还是**回答**（长、彼此相似），而你记得的是**自己那句话**。
 *
 * 所以这条导航条上一格 = **你问的一次**，位置按它在整条会话里的深浅摆，
 * 悬停给出那句话的原文，点一下跳过去。回答不占格：一轮里它可能说了五段，
 * 摆五格等于把「第几件事」这个尺度稀释掉。
 *
 * ## 为什么几何算在这里，而不是在组件里
 *
 * 这一层是纯函数：给一组落点和一个滚动盒子的三个数，算出每格画在哪、哪一格是当下。
 * 它没有 DOM、没有时钟，于是能用一张表把边界情形穷举掉——**内容不够长时整条不画**、
 * 落点挤在一起时不会算出负坐标、滚到底时最后一格必须是当下。
 * 这些都是读代码看不出来、出图也未必拍得到的东西。
 */

/** 一格。`text` 是那句话的原文，悬停时给出去。 */
export interface NavPoint {
  id: string
  text: string
}

/** 算完之后的一格：`y` 是**相对滚动可视区顶边**的像素。 */
export interface RailMark extends NavPoint {
  y: number
}

export interface RailBox {
  /** 内容总高。 */
  scrollHeight: number
  /** 可视区高。 */
  clientHeight: number
  scrollTop: number
}

/** 上下各留一点，免得第一格和最后一格贴着边被切掉。 */
const PAD = 10

/**
 * 短于这个数就不画。
 *
 * 内容比可视区高不了多少时，导航条上每一格都指向「几乎同一个位置」——
 * 那时它不是导航，是装饰。**滚不动就没有「我在哪儿」这个问题。**
 */
const MIN_OVERFLOW = 120

/** 当下那一格：视线上沿再往下一点点算「正在读」，而不是严格的顶边。 */
const READING = 0.2

export function railLayout(
  points: readonly (NavPoint & { top: number })[],
  box: RailBox,
): { marks: readonly RailMark[]; activeId: string | undefined } {
  const room = box.clientHeight - 2 * PAD
  if (points.length < 2 || box.scrollHeight - box.clientHeight < MIN_OVERFLOW || room <= 0) {
    return { marks: [], activeId: undefined }
  }
  const marks = points.map((point) => ({
    id: point.id,
    text: point.text,
    // 按它在**整条内容**里的深浅摆。分母用 scrollHeight 而不是可滚动距离：
    // 前者是「这条会话有多长」，后者会让最后一屏的落点全挤到底边
    y: PAD + Math.round(Math.min(1, Math.max(0, point.top / box.scrollHeight)) * room),
  }))
  const line = box.scrollTop + box.clientHeight * READING
  // 滚到底时最后一格必须是当下：那一屏里可能同时站着好几个落点
  const bottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 2
  const at = bottom ? points.length - 1 : points.findLastIndex((point) => point.top <= line)
  return { marks, activeId: points[at < 0 ? 0 : at]?.id }
}

/** 悬停卡里那两行：第一行是标题，其余压成一段。 */
export function railPeek(text: string): { title: string; body: string } {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line !== "")
  const title = lines[0] ?? ""
  return { title, body: lines.slice(1).join(" ") }
}

/**
 * 哪些行是导航条上的一格：**你在这条会话里问过的每一句**。
 *
 * 接力带过来的（`origin` 有值）不算——那不是你在这条会话里问的
 *（同 `lastMine` 那条判据）。抽成纯函数是为了让「哪些算一格」这件事
 *  有地方被测到，而不是散在组件的 `useMemo` 里。
 */
export function navPointsOf(
  rows: readonly { kind: string; item?: { id: string; kind: string; text?: string; origin?: unknown } }[],
): readonly NavPoint[] {
  return rows.flatMap((row) =>
    row.kind === "item" && row.item?.kind === "user_message" && row.item.origin === undefined
      ? [{ id: row.item.id, text: row.item.text ?? "" }]
      : [],
  )
}
