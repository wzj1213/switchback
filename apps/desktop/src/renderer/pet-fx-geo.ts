import type { Gun } from "./pet-gun.js"
import { TG_D, TG_UP } from "./pet-range.js"
import { SIZE, type Pet } from "./pets.js"

/**
 * 开火那一层的**几何**：手在哪、枪口在哪、抛壳口在哪、纸带和靶立在哪。
 *
 * 单拎出来不是行数逼的（虽然确实也逼到了），是因为这几个点位有一条共同的性质：
 * **它们全都从桌宠此刻的坐标现算，不缓存。** 那只每四秒跳一次、被拖着走、
 * 挨了一下会歪——任何一处存下来的锚点都会在下一帧变成错的，
 * 而错的锚点在画面上表现为「枪飘在人旁边」，看起来像贴上去的。
 */

/** 纸带离手多远、离地多高。 */
const TAPE_DX = 108
const TAPE_DY = 12
/** 纸带最左能漂到哪儿（相对手）。到头就没了。 */
const TAPE_LEN = 190
/**
 * 静默时纸带漂多快。**开火时的漂速不是常数**——它等于「每秒几发 × 一个字宽」，
 * 于是落下来的永远是一条排得开的字（见 `GLYPH_W`）。
 * 静默时给一个固定的快速度：一条不动的字带会一直挂在那儿，
 * 而「空闲整帧不重绘」那条优化就永远等不到「不动」这一刻。
 */
export const DRIFT_QUIET = 90
/**
 * 手在身子的哪个位置（占盒子的比例，不是绝对值——螃蟹和鲸的盒子不一样大）。
 *
 * **横向是负的：手在身子左沿外面一点点。** 画布压在桌宠底下，
 * 手心搁在身体内侧的话整把枪都被身子盖住，只剩枪口焰像个悬空的火星。
 */
const HAND_X = -0.04
const HAND_Y = 0.72
/** 枪管从手心往外探多远。出膛点＝手 + 这一段，按枪的指向旋过去。 */
const BARREL = 11
/** 抛壳口在枪的局部坐标（素材枪管指 -x，见 `pet-fx-draw.ts`）。 */
const PORT_X = -1
const PORT_Y = -3.6


/** 手心在哪（相对活动区）。桌宠本体的坐标是左上角。 */
export function handOf(pet: Pet): { x: number; y: number } {
  return { x: pet.x + SIZE * HAND_X, y: pet.y + SIZE * HAND_Y }
}

/** 枪口在哪。出膛点必须在这儿算——算在别处的话第一帧子弹会从画布左上角飞出来。 */
export function muzzleOf(gun: Gun): { x: number; y: number } {
  const a = gun.ang + gun.kick
  return { x: gun.x + Math.cos(a) * BARREL, y: gun.y + Math.sin(a) * BARREL }
}

/** 抛壳口在哪。局部点绕 `ang + π` 转过去——素材的枪管指 -x。 */
export function portOf(gun: Gun): { x: number; y: number } {
  const c = Math.cos(gun.ang)
  const s = Math.sin(gun.ang)
  return { x: gun.x - PORT_X * c + PORT_Y * s, y: gun.y - PORT_X * s - PORT_Y * c }
}

/** 纸带的落点与左边界。 */
export function tapeAt(hand: { x: number; y: number }): { x: number; y: number; left: number } {
  return { x: hand.x - TAPE_DX, y: hand.y - TAPE_DY, left: hand.x - TAPE_DX - TAPE_LEN }
}

/** 靶心在哪。立在手往左 `TG_D`，比脚线高 `TG_UP`。 */
export function targetAt(hand: { x: number; y: number }): { x: number; y: number } {
  return { x: hand.x - TG_D, y: hand.y + SIZE * (1 - HAND_Y) - TG_UP }
}

