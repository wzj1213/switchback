import { useEffect } from "react"
import type { Pet } from "./pets.js"

/**
 * 闲着的时候那点小动作：眨眼、瞟一眼、伸懒腰、抖两下、原地颠一下、打个盹，
 * 以及**两只对视一眼**。
 *
 * ## 为什么是「排班」不是 `infinite`
 *
 * 最初那版设计稿给的是三条常驻动画，闲着也在跑，而它们的位置正好在你打字时
 * 视线停的那个点上。`status.css` 早就把这件事写清楚过：一刻不停的动画会持续
 * 抢注意力，隔一段扫一道才不抢。所以这里是**一次一只、一次一个动作**，
 * 间隔本身也是随机的——固定周期的眨眼比不眨还假，人会认出那个节拍。
 *
 * ## 三条硬规矩
 *
 * 1. **直接往 DOM 上写类，不走 state。** 眨一次眼要是触发一次 React 重渲染，
 *    这几只每分钟就得把自己重画二三十遍——而它们每帧还在被 rAF 写 transform，
 *    两套更新撞在一起纯属自找。
 * 2. **只给待在窝里的那几只排班。** 在飞的那只身上叠一个伸懒腰，会和物理层
 *    写的 transform 打架（`petPaint` 的 `lean` 写的是行内样式，而 CSS 动画会盖掉它）。
 * 3. **正在跑的那只不排班。** 它身上那个四秒一次的跳是**状态指示**——
 *    「它在动 = 它在干活」，往上面叠装饰会把这句话说糊。
 */

export interface Mood {
  /** 落到 `.pet--<name>` 上的类名。 */
  name: string
  /** 演多久。到点把类摘掉，CSS 动画自然结束。 */
  ms: number
  /**
   * 抽中的权重。**眨眼占大头**：它是「这东西是活的」的底噪，
   * 别的每一个都是「发生了一件事」，一多就成了神经质。
   */
  weight: number
  /** 挑相邻的两只，一只往右看一只往左看：**它俩对视一眼**。 */
  pair?: boolean
}

export const MOODS: readonly Mood[] = [
  { name: "blink", ms: 130, weight: 9 },
  { name: "look-l", ms: 640, weight: 2 },
  { name: "look-r", ms: 640, weight: 2 },
  /** 伸个懒腰：先蹲一下再抻上去。最慢的一个，所以也最少 */
  { name: "stretch", ms: 900, weight: 2 },
  /** 抖两下，像甩掉身上的水 */
  { name: "wiggle", ms: 520, weight: 2 },
  /** 原地颠一下。比点它那一下（`BOOP`）轻得多——那是被戳，这是自己想动 */
  { name: "bounce", ms: 460, weight: 2 },
  /** 打个盹：眼睛闭上，身子慢慢起伏两下 */
  { name: "doze", ms: 2600, weight: 1 },
  /** 两只对视一眼。**这几只之间为数不多的一处「知道对方在」** */
  { name: "glance", ms: 700, weight: 2, pair: true },
]

/** 摘干净用。类是一个个加上去的，卸载时得有一张全表能一次撸掉。 */
const CLASSES = [...new Set(MOODS.flatMap((m) => (m.pair ? ["look-l", "look-r"] : [m.name])))].map(
  (n) => `pet--${n}`,
)

/**
 * 抽一个动作。**纯函数**：`roll` 是 `[0, 1)`，调用方给随机数，这里只做加权挑选。
 *
 * 分出来是为了能测——权重表调来调去，而「权重加起来能不能盖满 0~1」
 * 这种事肉眼看不出来，只有边界值试得出来。
 */
export function pickMood(roll: number): Mood {
  const total = MOODS.reduce((sum, m) => sum + m.weight, 0)
  const want = Math.min(Math.max(roll, 0), 0.999999) * total
  let seen = 0
  for (const mood of MOODS) {
    seen += mood.weight
    if (want < seen) return mood
  }
  // 落到这儿只可能是浮点误差。**回落到最轻的那个动作**，不是抛
  return MOODS[0] ?? { name: "blink", ms: 130, weight: 1 }
}

/** 这一轮能演给谁看：待在窝里、而且不是正在跑的那只。 */
function idleOf(
  nodes: readonly (HTMLButtonElement | null)[],
  pets: readonly Pet[],
  count: number,
): readonly number[] {
  const out: number[] = []
  for (let i = 0; i < count; i += 1) {
    const node = nodes[i]
    if (node === null || node === undefined) continue
    if (pets[i]?.mode !== "rest" || node.classList.contains("pet--run")) continue
    out.push(i)
  }
  return out
}

/** 挑一对**挨着的**。挨着才叫对视——隔着一只看，那是看穿了它。 */
function pairOf(idle: readonly number[], roll: number): readonly [number, number] | undefined {
  const pairs = idle.filter((i) => idle.includes(i + 1)).map((i): [number, number] => [i, i + 1])
  return pairs[Math.floor(roll * pairs.length)]
}

/** 一次排班要做的事：给谁、加哪几个类。 */
interface Act {
  targets: readonly { index: number; cls: string }[]
  ms: number
}

/** 这一轮演什么。**演不了就返回 undefined**（都在飞、或者都在跑），下一轮再说。 */
export function actOf(idle: readonly number[], mood: Mood, roll: number): Act | undefined {
  if (idle.length === 0) return undefined
  if (mood.pair === true) {
    const two = pairOf(idle, roll)
    // 凑不出相邻的一对就退回眨眼：宁可少一个动作，也不要硬凑一次「隔空对视」
    if (two === undefined) return actOf(idle, MOODS[0] ?? mood, roll)
    return {
      ms: mood.ms,
      targets: [
        { index: two[0], cls: "pet--look-r" },
        { index: two[1], cls: "pet--look-l" },
      ],
    }
  }
  const who = idle[Math.floor(roll * idle.length)] ?? idle[0] ?? 0
  return { ms: mood.ms, targets: [{ index: who, cls: `pet--${mood.name}` }] }
}

/** 两次小动作之间隔多久。**下限也随机**，固定节拍比不动还假。 */
const GAP_MIN = 2200
const GAP_SPAN = 4200

export function useMood(
  nodes: React.RefObject<(HTMLButtonElement | null)[]>,
  pets: React.RefObject<Pet[]>,
  count: number,
  reduced: boolean,
): void {
  useEffect(() => {
    if (reduced || count === 0) return undefined
    let alive = true
    /** **每个动作管自己的收尾。** 上一版共用一个 handle，两个动作叠上就会
        把前一个的收尾覆盖掉——那只会一直闭着眼，再也睁不开 */
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const later = (ms: number, run: () => void): void => {
      const id = setTimeout(() => {
        timers.delete(id)
        if (alive) run()
      }, ms)
      timers.add(id)
    }
    const again = (): void => {
      later(GAP_MIN + Math.random() * GAP_SPAN, () => {
        const act = actOf(idleOf(nodes.current, pets.current, count), pickMood(Math.random()), Math.random())
        for (const t of act?.targets ?? []) nodes.current[t.index]?.classList.add(t.cls)
        if (act !== undefined) {
          later(act.ms, () => {
            for (const t of act.targets) nodes.current[t.index]?.classList.remove(t.cls)
          })
        }
        again()
      })
    }
    again()
    return () => {
      alive = false
      for (const id of timers) clearTimeout(id)
      // 卸载时把没摘干净的类一次撸掉：留一只闭着眼的史莱姆比没有动画糟得多
      for (const node of nodes.current) node?.classList.remove(...CLASSES)
    }
  }, [nodes, pets, count, reduced])
}
