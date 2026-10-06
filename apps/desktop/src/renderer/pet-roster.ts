import type { EngineId, EngineInfo } from "@switchback/protocol"
import { lookOf, type PetLook } from "./pets.js"

/**
 * 桌宠花名册和引擎注册表不是一回事：前四个位置画宿主真的给出来的引擎，
 * 最后一个位置给尚未在设置中接入的 DSH 留一只。占位没有 `engine`，因此
 * 永远不会亮成当前引擎，也不会混进下拉、接力或会话状态。
 */

/** 真引擎最多画四只；第五格固定留给 DSH。 */
const REAL_MAX = 4

export interface PetSlot {
  /** DOM key。DSH 占位与真引擎共用视觉身份，实时接入时才能原地切换而不跳坐标。 */
  key: string
  /** 只有真引擎有。 */
  engine?: EngineId
  label: string
  look: PetLook
}

const DSH: PetSlot = {
  key: "dsh",
  label: "DSH · 去设置中接入",
  look: lookOf("dsh"),
}

export function petRoster(engines: readonly EngineInfo[], current: EngineId): readonly PetSlot[] {
  const dsh = engines.find(
    (engine) =>
      lookOf(engine.id).tone === "dsh" &&
      ((engine.state !== "missing" && engine.state !== "unavailable") || engine.id === current),
  )
  const others = engines.filter((engine) => lookOf(engine.id).tone !== "dsh")
  return [...pick(others, current).map(slotOf), dsh === undefined ? DSH : slotOf(dsh)]
}

/**
 * 把用户藏起来的那几只去掉。
 *
 * 两条特例，都指向同一件事——**台面上必须始终有一处画着「谁在答」**：
 *
 * - 当前那家藏不掉。用户可以在设置里勾掉它（清单里就是有这一项），
 *   但只要这一刻是它在跑，它就得在场；换到别家之后它才真的消失。
 * - **只剩一只（或者一只都没留）时，留下的永远是当前那家**，不管勾的是哪一个。
 *   「只留一只」这句话要的是「我只想看正在答的那个」；固定显示某一家的话，
 *   切到别家之后台面上站着的就是个错的身份，比不显示更糟。
 */
export function visibleRoster(
  all: readonly PetSlot[],
  current: EngineId,
  hidden: readonly string[],
): readonly PetSlot[] {
  const kept = all.filter((slot) => !hidden.includes(slot.key))
  if (kept.length > 1) return all.filter((slot) => !hidden.includes(slot.key) || slot.engine === current)
  const mine = all.find((slot) => slot.engine === current)
  return mine === undefined ? all.slice(0, 1) : [mine]
}

const slotOf = (info: EngineInfo): PetSlot => ({
  key: info.id,
  engine: info.id,
  label: info.label,
  look: lookOf(info.id),
})

/**
 * 装了的优先，最多 `REAL_MAX` 只，当前这家一定在里面；否则界面上就没有任何
 * 地方画着「谁在答」。DSH 永远单列在第五格，设置确认并探测成功后才把占位换成真引擎。
 */
function pick(engines: readonly EngineInfo[], current: EngineId): readonly EngineInfo[] {
  const usable = engines.filter(
    (engine) =>
      (engine.state !== "missing" && engine.state !== "unavailable") || engine.id === current,
  )
  const capped = usable.slice(0, REAL_MAX)
  if (capped.some((engine) => engine.id === current)) return capped
  const mine = usable.find((engine) => engine.id === current)
  return mine === undefined ? capped : [mine, ...capped.slice(0, REAL_MAX - 1)]
}
