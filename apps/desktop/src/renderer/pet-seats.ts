import type { Gait, Pet, Stage } from "./pets.js"
import { homeXOf, SIZE } from "./pets.js"

/**
 * 座位表：**花名册的 key ↔ 物理状态**。
 *
 * ## 为什么不能按下标对齐
 *
 * 上一版只比长度：`pets.length !== count` 才重建。而花名册**同样长、内容却换了**
 * 是常态——`visibleRoster` 在「只留一只」那一档返回的就是当前那家那一只，
 * 换个引擎开一条新会话，长度还是 1，里面已经是另一只了。
 *
 * 后果不是「颜色错了」这种轻的：长度没变 → 数组不重建 → 依赖 `count` 的
 * `layout` 身份也不变 → **那个 effect 一次都不跑**。而 React 刚给新 key 挂了一个
 * 全新的 `<button>`，它身上还没有任何 inline transform，`.pet` 又是
 * `position:absolute; top:0; left:0`——**于是它就钉在活动区的左上角，再也不动**。
 *
 * 按 key 对齐之后，「换了谁」是一件能被看见的事：留下的接着自己的位置，
 * 新来的按当前台面就位，走了的连同状态一起丢掉。
 */

/** 一只的座位。`gait` 跟着形走，见 `gaitOf`。 */
export interface Seat {
  key: string
  gait: Gait
}

export function sameSeats(a: readonly Seat[], b: readonly Seat[]): boolean {
  return a.length === b.length && a.every((seat, i) => seat.key === b[i]?.key)
}

/**
 * 按新座位表重排物理状态。
 *
 * - 还在的：**原样带过去**（包括正飞在空中的那一只——重建会让它瞬移回窝）
 * - 新来的：`undefined`，由调用方按当前台面就位
 * - 走了的：连状态一起丢
 */
export function reseat(
  was: readonly Seat[],
  pets: readonly Pet[],
  next: readonly Seat[],
): readonly (Pet | undefined)[] {
  const byKey = new Map<string, Pet>()
  for (const [i, seat] of was.entries()) {
    const pet = pets[i]
    if (pet !== undefined) byKey.set(seat.key, pet)
  }
  return next.map((seat) => byKey.get(seat.key))
}

/**
 * 台面量得准不准。
 *
 * **量不准就什么都别写。** 宽高为 0 的时候 `homeXOf` 会算出一个负数、
 * 地面会算成 `-SIZE`，两个都是屏幕外的左上方向——而那正是「桌宠卡在左上角」
 * 这个故障的样子。宁可这一帧不摆，也不要摆到一个确定错的地方。
 */
export function measured(stage: Stage): boolean {
  return stage.width >= 2 && stage.height >= 2
}

/** 窝在哪、地面在哪。 */
export function homeOf(index: number, count: number, right: number, stage: Stage): {
  x: number
  y: number
} {
  return { x: homeXOf(index, count, right), y: stage.height - SIZE }
}
