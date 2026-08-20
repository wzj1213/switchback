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
    lean(view.leans[i], pet, floor)
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

function lean(node: HTMLSpanElement | null | undefined, pet: Pet, floor: number): void {
  if (node === null || node === undefined) return
  if (pet.mode === "rest") {
    // 清空，把这一层还给 CSS（`.pet--held` 那档放大是写在样式表里的）
    node.style.transform = ""
    return
  }
  // 翻滚优先：真被甩出去时姿态角是累积的（会转好几圈），慢的时候只是顺着走势歪一点
  const angle = Math.abs(pet.spin) > 0.5 ? pet.spin : clamp(pet.vx * 0.022, -15, 15)
  const pull = clamp(Math.abs(pet.vy) / 2600, 0, 0.16)
  const rise = riseOf(pet, angle, pull, floor)
  node.style.transform = `translateY(${(-rise).toFixed(2)}px) rotate(${angle.toFixed(2)}deg) scale(${(1 - pull).toFixed(3)}, ${(1 + pull).toFixed(3)})`
}

/** 离地多高以内开始托。40 大约是一个身位半：再远就看得出它在「浮」。 */
const RISE_FADE = 40

/**
 * 翻着落地时要把身子托起来多少。
 *
 * ## 为什么非托不可
 *
 * 转轴在**脚下**（`transform-origin: bottom center`，因为压扁拉长都得踩着地演），
 * 而物理只把它当一个 30×30 的正方盒。一转起来，身子就伸到盒子外面去了——
 * 翻到头朝下时**整整一个身位在盒子底下**。实测一次乱摔最深 27px：
 * 小半只宠物埋进输入框里。
 *
 * 这里算的就是「转成这个角度之后，最低的那个角比脚线低多少」：
 * 底边两个角贡献 `sin`，翻过头（`cos < 0`）时整个身子还要再吊下去一截。
 *
 * ## 只在贴地时托
 *
 * 空中不托——那时候它**本来就该翻得满天飞**，托起来反而像被线吊着。
 * 越接近地面托得越足，两个量都是连续的，所以中间没有跳变。
 */
function riseOf(pet: Pet, angle: number, pull: number, floor: number): number {
  const rad = (angle * Math.PI) / 180
  // 抻长那一档也要算进去：竖着被拉长 16% 的时候，倒栽葱的那一截也长 16%。
  // **再留一成半余量**：身体那一层同时还在演砸扁（最多横着撑开 30%，见 `Pets.tsx`
  // 的 `squash`），而这一层看不见那个动画的实时值。宁可多托两像素——
  // 那看起来只是「还在翻」，少托两像素看起来是「埋进去了」
  const half = (SIZE / 2) * (1 - pull) * 1.25
  const tall = SIZE * (1 + pull)
  const dip = half * Math.abs(Math.sin(rad)) - tall * Math.min(0, Math.cos(rad))
  const near = clamp(1 - (floor - pet.y) / RISE_FADE, 0, 1)
  return dip * near
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
