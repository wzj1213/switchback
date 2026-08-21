import type { EngineId, EngineInfo } from "@omni/protocol"
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
      lookOf(engine.id).tone === "dsh" && (engine.state !== "missing" || engine.id === current),
  )
  const others = engines.filter((engine) => lookOf(engine.id).tone !== "dsh")
  return [...pick(others, current).map(slotOf), dsh === undefined ? DSH : slotOf(dsh)]
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
  const usable = engines.filter((engine) => engine.state !== "missing" || engine.id === current)
  const capped = usable.slice(0, REAL_MAX)
  if (capped.some((engine) => engine.id === current)) return capped
  const mine = usable.find((engine) => engine.id === current)
  return mine === undefined ? capped : [mine, ...capped.slice(0, REAL_MAX - 1)]
}
