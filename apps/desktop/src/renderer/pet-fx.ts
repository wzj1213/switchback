import { brassMoving, eject, heave, stepBrass, sweep } from "./pet-brass.js"
import { emptied, kickOf, loaded, MAX_DT, RELOAD_ANGLE, RELOAD_SHOTS, stepGun, wrapAngle } from "./pet-gun.js"
import { fireStep, GLYPH_W, pushGlyph, rpsOf, spawn, stepShots, stepTape } from "./pet-shots.js"
import { hitFoe, nearest, nextGap, pressureOf, spawnFoes, stepFoes, type Foe } from "./pet-foes.js"
import { land, punch, showMoving, stepShow, TG_D } from "./pet-range.js"
import { DRIFT_QUIET, handOf, muzzleOf, portOf, standOf, tapeAt, targetAt } from "./pet-fx-geo.js"
import type { FxInput, FxWorld, Shot } from "./pet-fx-world.js"
import { SIZE } from "./pets.js"

export { handOf, muzzleOf, portOf, standOf, tapeAt, targetAt } from "./pet-fx-geo.js"
export type { Field, Stand } from "./pet-fx-geo.js"
export { createFx, resetFx } from "./pet-fx-world.js"
export type { FxInput, FxWorld, View } from "./pet-fx-world.js"

/**
 * 开火那一层的世界。**把几个纯模块（枪、子弹、纸带、弹壳、怪、靶）串成一帧。**
 *
 * ## 这一层为什么和桌宠本体是分开的
 *
 * 桌宠本体（`pets.ts` / `usePets.ts` / `petPaint.ts`）回答的是「它在哪、
 * 你把它扔到哪儿去了」——那是 DOM 上的三层 transform，和这里没有关系。
 * 这一层回答的是「引擎此刻吐得多快」，画在**一张 canvas** 上。
 *
 * 两层之间只有两个只读接口：**`Pet` 的坐标**（枪挂在手上）和**台面**
 *（`FxInput.field`：窝在哪、地面线在哪——靶钉在这上面，不钉在人身上）。
 * 除此之外不碰对方任何东西——不读 DOM、不发事件、不共享可变状态。
 * 所以关掉 fx 时桌宠一切照旧，反过来也一样。
 *
 * ## 一帧只推进一次，画不画是另一件事
 *
 * `stepFx` 只改状态，`drawFx`（另一个文件）只读状态。分开是因为**空闲时要跳过绘制**
 * 而不能跳过推进——跳过推进的话，那些本该在这几帧里飞完的子弹会一直挂着，
 * 于是「不动了」这一刻永远不到，跳帧优化反而永远等不到机会。
 *
 * ## `stepFx` 是**原地改**的，而且明说
 *
 * 上一版它返回 `{...w}`，看起来像纯函数——**但里面那几个数组是共着的**。
 * 装成纯的比明着改更危险，所以现在它就是个原地改的推进器：一帧一个世界，
 * 要分支就自己另起一个。
 */

/**
 * 推进一帧。`dt` 秒，**调用方不必夹**——这里夹（`MAX_DT`），
 * 因为夹的理由（弹簧的稳定门槛）属于这一层。
 */
/** 钟一帧最多推进多少秒。见 `stepFx` 开头。 */
const WALL_MAX = 1

export function stepFx(w: FxWorld, rawDt: number, input: FxInput): void {
  // **弹簧夹得紧，钟夹得松，但两个都得夹。**
  //
  // 弹簧那道（`MAX_DT`）是显式欧拉的稳定门槛，只管物理。钟不能跟着夹在 50ms：
  // 闲下来之后这一层退到 120ms 一拍（见 `PetFxCanvas.tsx`），夹住的话
  // 「静默三秒」要等上七秒半才成立。
  //
  // 但钟也**不能完全不夹**——上一版就是不夹的，于是切到别的应用去待五分钟，
  // 回来那一帧的 `dt` 是三百秒：`quiet` 和 `clock` 一次性跳过去，压力当场拉满、
  // 怪立刻蹦出来，屏幕上是「一回来就炸了」。而设计上那一刻恰恰是
  // **你才刚回来**，不是「已经被围了」（同 `spawnDue` 里那句「压力消失又出现时
  // 不会当场蹦一只」）。1 秒对 120ms 的慢拍有八倍余量，够了。
  const real = Math.min(rawDt > 0 ? rawDt : 1 / 60, WALL_MAX)
  const dt = Math.min(real, MAX_DT)
  const hand = handOf(input.pet, input.shape)
  w.quiet = input.rate > 1 ? 0 : w.quiet + real
  w.clock += real
  spawnDue(w, input, hand)
  aimAndFire(w, dt, input, hand)
  // 落地算什么由这儿定：纸带上落一个字、敌人掉一点血、靶上留一个洞
  stepShots(w.bullets, dt, (b) => {
    landOne(w, b as Shot, input)
  })
  w.bites += stepFoes(w.foes, dt, hand.x, eaterOf(w))
  stepBrass(w.brass, dt)
  // 结账那一下把弹壳堆扫平。**判据是「这一轮跑完了」**，不是别的：
  // 堆多高＝这一轮吐了多少，那一堆的意义只到结账为止
  if (w.ran && !input.running) sweep(w.brass, input.rand)
  const rps = rpsOf(readyRate(w, input))
  // 收工就把纸带淡掉：这一轮结束了，输入框上面不该还挂着几个零散的字
  stepTape(w.tape, dt, { speed: rps > 0 ? rps * GLYPH_W : DRIFT_QUIET, left: tapeAt(hand).left, clear: !input.running })
  w.ran = input.running
  // 靶场显形：这一轮在跑、枪还没收、或者还有子弹在飞，都算「在开火」。
  // **跑完那几秒的按住不算 moving**——画面不变，不值得为它续一条 rAF
  const live = input.range && (input.running || w.gun.arm > 0 || w.bullets.length > 0)
  stepShow(w.show, dt, live)
  w.moving = busyOf(w) || (input.range && showMoving(w.show, live))
  w.view = {
    handX: hand.x,
    handY: hand.y,
    ground: groundOf(input),
    stand: standOf(input.field, input.shape),
    rate: input.rate,
    speed: input.speed,
    ratio: input.ratio,
    bench: input.bench,
  }
}

function landOne(w: FxWorld, b: Shot, input: FxInput): void {
  if (b.hole !== undefined) {
    land(w.target, b.hole)
    return
  }
  if (b.foe !== undefined) {
    hitFoe(b.foe, { x: b.x1, y: b.y1 }, input.rand)
    return
  }
  pushGlyph(w.tape, b)
}

/** 瞄哪儿、这一帧打几发。 */
function aimAndFire(w: FxWorld, dt: number, input: FxInput, hand: { x: number; y: number }): void {
  const aim = aimOf(w, input, hand)
  const firing = input.rate > 1 && !input.busyHands
  // 换弹那半秒枪口垂下来——**这个动作就是「换弹」本身**，不另画一套动画：
  // 一把突然停火又不动的枪看起来是卡住了，垂一下再抬起来才读得出「它在装弹」
  const want = !loaded(w.gun)
    ? RELOAD_ANGLE
    : firing
      ? wrapAngle(Math.atan2(aim.y - w.gun.y, aim.x - w.gun.x))
      : Math.PI * 1.02
  w.gun = stepGun(w.gun, dt, { hand, want, armed: firing, hard: input.busyHands })
  const step = fireStep(w.acc, readyRate(w, input), dt)
  w.acc = step.acc
  if (loaded(w.gun)) fireOut(w, step.shots, aim, input)
}

/**
 * 打向哪儿。三条，优先级从硬到软：
 *
 * 1. **打靶**开着就打靶——那是个评估台，开着的时候你要看的就是那张靶；
 * 2. 有东西过来就瞄它，否则它会一路走到你脸上，而你手里正端着一把朝别处的枪；
 * 3. 都没有就对着纸带打。
 */
function aimOf(
  w: FxWorld,
  input: FxInput,
  hand: { x: number; y: number },
): { x: number; y: number } {
  if (input.range) return targetAt(standOf(input.field, input.shape))
  const foe = nearest(w.foes)
  if (foe !== undefined) return { x: foe.x + foe.knock, y: foe.y - 11 - foe.fly }
  return tapeAt(hand)
}

/** 抽利落之前射速按 0 算，于是「先抽枪、再开打」自然成了一个节拍。 */
function readyRate(w: FxWorld, input: FxInput): number {
  const firing = input.rate > 1 && !input.busyHands
  return firing && w.gun.arm > 0.55 ? input.rate : 0
}

/** 出膛。 */
function fireOut(w: FxWorld, shots: number, aim: { x: number; y: number }, input: FxInput): void {
  if (shots <= 0) return
  const foe = input.range ? undefined : nearest(w.foes)
  // **壳落到台面，不落到那只此刻的脚下。**
  //
  // 上一版这里给的是 `groundOf(input)`（那只的脚线），理由写在 `View.ground` 上：
  // 「弹壳是从这把枪里飞出来的，跟着人走是对的」。那句话在它**站着**时没问题——
  // 站着时脚线就是台面。可你把它拎起来一边拖一边打的时候，每一枚壳都停在
  // 「甩出去那一刻它的脚在哪儿」：半空中，各停各的高度，整屏铺满悬着的壳。
  // 那不是重量感，是没有重量——**掉下去的东西该掉到地上**。
  const port = { ...portOf(w.gun), angle: w.gun.ang, ground: input.field.ground }
  // **抛壳那一档下这一发就是那枚壳**：不另外造一颗子弹，也不再从抛壳口甩第二枚
  //（一发两枚就说不清哪一个是「这一发」了）。
  // 有东西爬过来、或者打靶开着时不算——那两种情况下照旧直射，见 `PetKit.traj`
  const lob = input.traj === "shell" && foe === undefined && !input.range
  for (let s = 0; s < shots; s++) {
    if (lob) {
      heave(w.brass, input.brass === "pile", port, input.rand)
      continue
    }
    w.bullets.push(shotOf(w, aim, foe, input))
    eject(w.brass, input.brass, port, input.rand)
  }
  const empty = emptied(w.gun, shots)
  w.gun = kickOf(w.gun, shots)
  if (empty) reload(w, input)
}

/**
 * 打空一匣，换弹。
 *
 * ## 停的是「几发的工夫」，不是几秒
 *
 * 从 `acc` 上直接扣掉 `RELOAD_SHOTS` 发——那正好是**几发的工夫**，
 * 而不是一个固定秒数。占空比于是和流速无关：快慢都是同样的比例，
 * 「流速翻倍、发数翻倍」照旧成立（理由写在 `RELOAD_SHOTS` 上）。
 *
 * 枪口垂下来的那一段用同样的时长——它得和真正停火的那一段严丝合缝，
 * 早抬起来会看到「举着枪却不打」，晚抬起来会看到「打完了枪还垂着」。
 */
function reload(w: FxWorld, input: FxInput): void {
  w.acc -= RELOAD_SHOTS
  const rps = rpsOf(readyRate(w, input))
  w.gun = { ...w.gun, reload: rps > 0 ? RELOAD_SHOTS / rps : 0 }
}

/** 造一发。打靶那一档先把落点算出来，落到的那一刻才记账（见 `pet-range.ts`）。 */
function shotOf(
  w: FxWorld,
  aim: { x: number; y: number },
  foe: Foe | undefined,
  input: FxInput,
): Shot {
  const muzzle = muzzleOf(w.gun)
  // 只有落到纸带上的那一发才取字：打怪、打靶的那几发取了也落不下，白白跳过一个字
  const ch = input.range || foe !== undefined ? "" : input.nextChar()
  const b: Shot = spawn(muzzle, aim, ch, [input.rand() - 0.5, input.rand() - 0.5])
  if (input.range) {
    // **靶钉死之后距离是个变量**：散布按它放大，飞行时间也按它拉长——
    // 把桌宠拖远，那一串弹着变散、子弹在空中待得更久，两件事都该看得见
    const dist = Math.hypot(aim.x - muzzle.x, aim.y - muzzle.y)
    const hole = punch({ kick: w.gun.kick, ratio: input.ratio, dist }, input.rand)
    b.hole = hole
    b.x1 = aim.x + hole.x
    b.y1 = aim.y + hole.y
    b.dur *= Math.max(0.35, dist / TG_D)
    return b
  }
  if (foe !== undefined) b.foe = foe
  return b
}

/** 弹壳落到哪条线上：脚线。 */
function groundOf(input: FxInput): number {
  return input.pet.y + SIZE
}

/**
 * 胖子吃字。返回这一口吃掉了哪几个字——碎屑要崩在字原来的位置上。
 *
 * 闭包而不是把纸带递进 `pet-foes`：那个模块不认识纸带，认识了就得
 * import 子弹那一路，而两边本来毫无关系。
 */
function eaterOf(w: FxWorld): (x: number, reach: number) => readonly { x: number; y: number }[] {
  return (x, reach) => {
    const eaten: { x: number; y: number }[] = []
    for (let i = w.tape.length - 1; i >= 0; i--) {
      const g = w.tape[i]
      if (g === undefined || Math.abs(g.x - x) >= reach) continue
      eaten.push({ x: g.x, y: g.y })
      w.tape.splice(i, 1)
    }
    return eaten
  }
}

/**
 * 这一帧之后还有没有东西在动。
 *
 * **判据必须囊括每一样会自己变的东西**：漏掉一样，那样东西就会在跳帧之后
 * 冻在半路上（而且不报错——canvas 保留着上一帧，看起来只是「卡了一下」）。
 */
function busyOf(w: FxWorld): boolean {
  return (
    w.bullets.length > 0 ||
    w.tape.length > 0 ||
    w.foes.length > 0 ||
    brassMoving(w.brass) ||
    w.gun.arm > 0 ||
    w.gun.reload > 0 ||
    Math.abs(w.gun.kick) > 0.002
  )
}

/**
 * 到点没到点该放一只。
 *
 * 没压力的时候**把下一次也往后推**：不推的话，压力一消失、时钟照走，
 * 等它再出现时 `clock` 早就越过了 `nextAt`，于是当场蹦一只出来——
 * 而那一刻恰恰是「刚刚才开始不顺」，不该已经被围了。
 */
function spawnDue(w: FxWorld, input: FxInput, hand: { x: number; y: number }): void {
  const press = pressureOf({
    running: input.running,
    rate: input.rate,
    quiet: w.quiet,
    ratio: input.ratio,
  })
  // 打靶开着时不刷怪：那张靶要的是干净的弹着，被一群东西挡在中间就读不出散布了
  if (press === undefined || !input.foes || input.range) {
    w.nextAt = Math.max(w.nextAt, w.clock + 3)
    return
  }
  if (w.clock < w.nextAt) return
  w.nextAt = w.clock + nextGap(press.level)
  spawnFoes(w.foes, press.kind, { from: input.left, ground: hand.y + 4 }, input.rand)
}
