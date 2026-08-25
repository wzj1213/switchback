import type { Hit } from "./pets.js"

/**
 * 挨了一下之后画面上发生什么。
 *
 * 砸到地、撞到墙、撞到同伴走的都是这一件事（判据在 `pets.ts` 的 `hitOf`）：
 * **在眼睛看来它们没有区别——都是挨了一下**，区别只在朝哪个方向挨的，
 * 以及挨得有多狠。这个文件就是把那两个量翻译成三种反应。
 *
 * 从 `Pets.tsx` 搬出来是行数闸门逼的，但边界也对：组件负责「谁挨了」，
 * 这里负责「挨了之后长什么样」。
 */

/** 这一层要动的两组节点。`Pets.tsx` 在回调里把当时的值递进来。 */
export interface HitView {
  bodies: readonly (HTMLSpanElement | null)[]
  nodes: readonly (HTMLButtonElement | null)[]
}

/** 旁边那只被震一下：往上一弹再落回去。比「探头」短促——那是好奇，这是被吓到 */
const JOLT: Keyframe[] = [
  { transform: "translateY(0) scale(1, 1)" },
  { transform: "translateY(-3px) scale(0.97, 1.04)", offset: 0.35 },
  { transform: "translateY(0) scale(1.04, 0.97)", offset: 0.7 },
  { transform: "translateY(0) scale(1, 1)" },
]

/** 砸得比这轻就不惊动旁边的——轻轻放下不该让全场抖一下 */
const JOLT_AT = 900

/** 挨得够狠才眯一下眼（一记「哎哟」）。**不能每次落地都眯**——
    蹦回窝的每一跳都算落地，每跳眯一次就成了抽搐 */
const WINCE_AT = 700
const WINCE_MS = 220

/** 眯一下眼。复用眨眼那一档：**它本来就是「眼睛闭上」这一件事**，没必要再发明一个。 */
function wince(node: HTMLButtonElement | null | undefined): void {
  if (node === null || node === undefined) return
  node.classList.add("pet--blink")
  setTimeout(() => {
    node.classList.remove("pet--blink")
  }, WINCE_MS)
}

/**
 * 挨了一下的那三帧：**顺着挨打的方向压，再反弹回来**。
 *
 * 从天上砸下来是压扁（矮胖），横着挨一记是压瘦（细高）——同一个形演两种撞击，
 * 撞击就没了方向；而方向恰恰是「刚才发生了什么」的全部内容。
 */
function squash(k: number, axis: Hit["axis"]): Keyframe[] {
  const hit = axis === "y" ? [1 + k, 1 - k] : [1 - k, 1 + k]
  const back = axis === "y" ? [1 - k * 0.4, 1 + k * 0.4] : [1 + k * 0.4, 1 - k * 0.4]
  return [
    { transform: `scale(${String(hit[0])}, ${String(hit[1])})` },
    { transform: `scale(${String(back[0])}, ${String(back[1])})`, offset: 0.45 },
    { transform: "scale(1, 1)" },
  ]
}

/**
 * 按落地速度定砸扁的深浅：轻轻放下几乎看不出，从对话框顶上摔下来会实实在在瘪一下。
 */
export function applyHit(view: HitView, index: number, hit: Hit, reduced: boolean): void {
  if (reduced) return
  const k = Math.min(0.3, hit.speed / 2600)
  view.bodies[index]?.animate(squash(k, hit.axis), { duration: 300, easing: "ease-out" })
  if (hit.speed >= WINCE_AT) wince(view.nodes[index])
  // 砸得够重时，旁边站着的会被**震一下**。物理上不成立（它们又没连在一起），
  // 但这是整套里最便宜的一处「它们在同一个世界里」——而那正是想要的
  if (hit.speed < JOLT_AT) return
  for (const [j, body] of view.bodies.entries()) {
    if (j !== index) body?.animate(JOLT, { duration: 260, easing: "ease-out" })
  }
}
