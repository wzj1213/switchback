import { SIZE, type Pet, type Stage } from "./pets.js"

/**
 * 每帧往 DOM 上写的那点东西。**不走 React**——每帧 setState 会把整棵子树重渲染，
 * 而这里要动的只有三个 transform。
 *
 * ## 三层各管各的，不能合并
 *
 * - `.pet` —— 位置。只有它跟着物理走。
 * - `.pet__lean` —— 倾斜与抻长。**被拽着的东西不会还是方的**：横着甩就往前倾，
 *   竖直速度大就沿着运动方向抻长一点（拉伸挤压，动画里最老的那条规矩）。
 * - `.pet__body` —— 蹦的动画（CSS）和蹦一下 / 砸扁（WAAPI）。
 *
 * 合成一层的话，位置、倾斜、动画三者会互相盖掉——`transform` 只有一个。
 *
 * ## 影子为什么单独一个元素
 *
 * 影子**钉在地面上，不跟着抬**。它是「它现在离地多高」唯一的说法：
 * 没有影子的话，一只飞在半空的史莱姆和一只站在地上的史莱姆在屏幕上是同一张图，
 * 而整个拖着玩的手感全靠这个高度差。
 */

export interface PetView {
  nodes: readonly (HTMLButtonElement | null)[]
  leans: readonly (HTMLSpanElement | null)[]
  shades: readonly (HTMLSpanElement | null)[]
}

/** 影子的横宽。**比身子略宽**：一样宽的话站着时它整个被盖住，
    而「站在地上」这件事恰恰要靠脚边露出来的那一圈说。 */
const SHADE_W = 26

export function paintPets(view: PetView, pets: readonly Pet[], stage: Stage): void {
  const floor = stage.height - SIZE
  for (const [i, pet] of pets.entries()) {
    place(view.nodes[i], pet)
    lean(view.leans[i], pet)
    shade(view.shades[i], pet, floor)
  }
}

function place(node: HTMLButtonElement | null | undefined, pet: Pet): void {
  if (node === null || node === undefined) return
  node.style.transform = `translate3d(${String(Math.round(pet.x))}px, ${String(Math.round(pet.y))}px, 0)`
  // 步态和离地与否要落到类上（螃蟹走路的那点晃、离地时的层级），
  // 而它们每帧都可能变——**用 classList 而不是 state**，不然一帧一次重渲染
  node.classList.toggle("pet--walk", pet.mode === "walk")
  node.classList.toggle("pet--air", pet.mode === "air" || pet.mode === "hop")
}

function lean(node: HTMLSpanElement | null | undefined, pet: Pet): void {
  if (node === null || node === undefined) return
  if (pet.mode === "rest") {
    // 清空，把这一层还给 CSS（`.pet--held` 那档放大是写在样式表里的）
    node.style.transform = ""
    return
  }
  // 翻滚优先：真被甩出去时姿态角是累积的（会转好几圈），慢的时候只是顺着走势歪一点
  const angle = Math.abs(pet.spin) > 0.5 ? pet.spin : clamp(pet.vx * 0.022, -15, 15)
  const pull = clamp(Math.abs(pet.vy) / 2600, 0, 0.16)
  node.style.transform = `rotate(${angle.toFixed(2)}deg) scale(${(1 - pull).toFixed(3)}, ${(1 + pull).toFixed(3)})`
}

function shade(node: HTMLSpanElement | null | undefined, pet: Pet, floor: number): void {
  if (node === null || node === undefined) return
  const high = floor <= 0 ? 0 : clamp((floor - pet.y) / floor, 0, 1)
  // 越高影子越小越淡。0.5 是下限：全没了的话「它在最上面」和「它不见了」没区别
  const k = 1 - high * 0.5
  const x = Math.round(pet.x + SIZE / 2 - SHADE_W / 2)
  // 落在脚线上，一半压在身子底下一半露出来
  const y = Math.round(floor + SIZE - 5)
  node.style.transform = `translate3d(${String(x)}px, ${String(y)}px, 0) scale(${k.toFixed(3)})`
  // 浓度分两步：这里只给「还剩几成」，最终值由 css 乘上分主题的那一档
  //（深色地面上同样的黑什么都看不出来，见 pets.css 的 `--pet-shade-a`）
  node.style.opacity = `calc(${k.toFixed(3)} * var(--pet-shade-a))`
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
