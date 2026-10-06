import type { ApprovalAsk } from "@switchback/engine"
import type { Event, Item, ItemId, LaneRef, TurnId } from "@switchback/protocol"

/**
 * 引擎给的 item id 只保证在它自己的原生会话里可引用，不能直接当 Switchback 全局 id。
 * 一条 Switchback 会话会中途换引擎；两家都报 `c1` 时，store 会把后一条当更新覆盖前一条。
 */
export interface ItemScope {
  event: (event: Event) => Event
  ask: (ask: ApprovalAsk, turnId: TurnId | undefined) => ApprovalAsk
}

/**
 * **审批与错误永远留在主线。**
 *
 * 它们和别的 item 一样继承 `ItemBase`，所以类型上拦不住 `lane` 这个字段——
 * 而一旦带上，分流选择器就会把它们抽进侧栏。侧栏关着、或者用户正在看另一条旁路时，
 * 一张**正在等他点**的审批卡就这么没了；而 Switchback 刚发过一版专治
 * 「点了没反应、转圈没尽头」，这是在同一个坑上新挖一个入口。
 *
 * 写成运行时闸门而不是 README 里的一句话：类型表达不了「这两种 kind 不许有这个字段」，
 * 而一个只写在文档里的约束，接第五家引擎时没人会记得。
 */
function mainlineOnly(item: Item): LaneRef | undefined {
  return item.kind === "approval" || item.kind === "error" ? undefined : item.lane
}

export function createItemScope(newId: (prefix: string) => ItemId): ItemScope {
  const byTurn = new Map<TurnId, Map<ItemId, ItemId>>()
  const latest = new Map<ItemId, ItemId>()
  /**
   * 引擎的 lane id → Switchback 的。**不按轮次分**：一条 lane 跨好几轮
   *（workflow 是后台跑的，主循环早收工了），按轮次分会让同一条 lane
   * 在下一轮里变成另一条。
   */
  const lanes = new Map<string, string>()

  const laneOf = (native: string): string => {
    const known = lanes.get(native)
    if (known !== undefined) return known
    const scoped = newId("ln")
    lanes.set(native, scoped)
    return scoped
  }

  const idOf = (turnId: TurnId, native: ItemId): ItemId => {
    const turn = byTurn.get(turnId) ?? new Map<ItemId, ItemId>()
    if (!byTurn.has(turnId)) byTurn.set(turnId, turn)
    const known = turn.get(native)
    if (known !== undefined) return known
    const scoped = newId("it")
    turn.set(native, scoped)
    latest.set(native, scoped)
    return scoped
  }

  return {
    event: (event) => {
      if (event.type === "item.delta") {
        const itemId = latest.get(event.itemId)
        return itemId === undefined ? event : { ...event, itemId }
      }
      if (event.type === "item.removed") {
        return { ...event, itemId: idOf(event.turnId, event.itemId) }
      }
      if (event.type === "lane.updated") {
        return { ...event, lane: { ...event.lane, id: laneOf(event.lane.id) } }
      }
      if (event.type !== "item.started" && event.type !== "item.updated") return event
      const id = idOf(event.item.turnId, event.item.id)
      latest.set(event.item.id, id)
      // lane 与它挂住的工具 id 都要重铸；只改 lane 会让“从主线工具进入旁路”指向原生 id。
      const lane = mainlineOnly(event.item)
      // 显式写 `lane: undefined` 而不是「不带这个键」：`{...item}` 已经把原来那个
      // 带进来了，条件展开一个空对象**盖不掉它**。落盘时 `JSON.stringify` 会丢掉
      // undefined，所以磁盘上仍然是干净的
      const scoped = lane === undefined
        ? { lane: undefined }
        : {
            lane: {
              ...lane,
              id: laneOf(lane.id),
              ...(lane.originItemId === undefined
                ? {}
                : { originItemId: idOf(event.item.turnId, lane.originItemId) }),
            },
          }
      // 原来那个 id 留作 `nativeId`：到引擎自己的原始记录里对位只能靠它
      return { ...event, item: { ...event.item, id, nativeId: event.item.nativeId ?? event.item.id, ...scoped } }
    },
    ask: (ask, turnId) =>
      turnId === undefined ? ask : { ...ask, toolCallId: idOf(turnId, ask.toolCallId) },
  }
}
