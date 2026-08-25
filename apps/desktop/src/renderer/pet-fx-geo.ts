import type { Gun } from "./pet-gun.js"
import { TG_D, TG_R, TG_UP } from "./pet-range.js"
import { SIZE, type Pet, type PetShape } from "./pets.js"

/**
 * 开火那一层的**几何**：手在哪、枪口在哪、抛壳口在哪、纸带和靶立在哪。
 *
 * 单拎出来不是行数逼的（虽然确实也逼到了），是因为这几个点位有一条共同的性质：
 * **它们全都从桌宠此刻的坐标现算，不缓存。** 那只每四秒跳一次、被拖着走、
 * 挨了一下会歪——任何一处存下来的锚点都会在下一帧变成错的，
 * 而错的锚点在画面上表现为「枪飘在人旁边」，看起来像贴上去的。
 *
 * **`standOf` 是唯一的例外，而且是故意的**：靶不跟着人走，它从「窝」算。
 * 窝一天变不了两次（换引擎、拉窗口），所以它照样是现算的——只是算的输入
 * 换成了台面而不是那只此刻在哪。理由见 `pet-range.ts` 开头。
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
 * 手在身子的哪个位置（占物理盒子的比例）。不能拿一套挂点套所有形：
 * 螃蟹的 12×9 图形在 30px 方盒里底对齐，横臂实际位于 y≈13–18；通用的 72%
 * 会把枪接到腿上，看起来像悬在身体旁边。
 *
 * **横向是负的：手在身子左沿外面一点点。** 画布压在桌宠底下，
 * 手心搁在身体内侧的话整把枪都被身子盖住，只剩枪口焰像个悬空的火星。
 */
const MOUNT: Readonly<Record<PetShape, { x: number; y: number }>> = {
  slime: { x: -0.04, y: 0.72 },
  // 机匣压进左臂一小截，枪管仍从身体左侧伸出。
  crab: { x: 0.04, y: 0.52 },
  "dsh-mark": { x: -0.04, y: 0.72 },
}
/** 枪管从手心往外探多远。出膛点＝手 + 这一段，按枪的指向旋过去。 */
const BARREL = 11
/** 抛壳口在枪的局部坐标（素材枪管指 -x，见 `pet-fx-draw.ts`）。 */
const PORT_X = -1
const PORT_Y = -3.6


/** 手心在哪（相对活动区）。桌宠本体的坐标是左上角。 */
export function handOf(pet: Pet, shape: PetShape): { x: number; y: number } {
  const mount = MOUNT[shape]
  return { x: pet.x + SIZE * mount.x, y: pet.y + SIZE * mount.y }
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

/**
 * 靶立在哪儿。**这儿是这一层唯一一处不从桌宠此刻的坐标算的东西**——
 * 它算的是「那只**待在窝里**的时候手在哪」，再往左 `TG_D`。
 * 于是靶钉死在台面上，桌宠动它不动（理由见 `pet-range.ts` 开头）。
 *
 * 往右夹一道：窄窗口下窝本身就很靠左，`homeX - TG_D` 会跑到画布外面去，
 * **而画布外面的靶等于没有靶**——那时宁可近一点打。
 */
export function standOf(field: Field, shape: PetShape): Stand {
  return {
    x: Math.max(TG_R + 12, field.homeX + SIZE * MOUNT[shape].x - TG_D),
    ground: field.ground,
  }
}

/** 台面：窝在哪、地面线在哪。**两个都和那只此刻的位置无关。** */
export interface Field {
  /** 当前那只的窝（左上角 x）。 */
  homeX: number
  /** 地面线。窝里那只的脚踩在这儿。 */
  ground: number
}

/** 靶的立足点。**钉死的**。 */
export interface Stand {
  x: number
  ground: number
}

/** 靶心在哪。立在 `stand.x`，比地面线高 `TG_UP`。 */
export function targetAt(stand: Stand): { x: number; y: number } {
  return { x: stand.x, y: stand.ground - TG_UP }
}
