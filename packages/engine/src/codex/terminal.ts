import { itemToSwitchback } from "./translate.js"
import type { NotifyContext } from "./notify.js"
import type { WireItem, WireTerminalInteraction } from "./wire.js"

/** completed 快照不重复携带独立通知里的 stdin；合并后再替换，避免历史被终态抹掉。 */
export function retainTerminalInputs(item: WireItem, previous: WireItem | undefined): WireItem {
  const inputs = previous?.terminalInputs
  if (item.type !== "commandExecution" || inputs === undefined || inputs.length === 0) return item
  return { ...item, terminalInputs: inputs, waitingForTerminal: false }
}

/**
 * 空 stdin 是 Codex 对仍存活后台进程的一次轮询；非空 stdin 是已经完成的真实写入。
 * 两者都更新原命令，不另造一个宿主猜出来的工具调用。
 */
export function onTerminalInteraction(ctx: NotifyContext, params: WireTerminalInteraction): void {
  const turnId = ctx.turnId()
  const previous = ctx.inflight.get(params.itemId)
  if (turnId === undefined || previous?.type !== "commandExecution") return
  // unified exec 会反复用空 stdin 轮询同一后台进程；状态没有变化就不重复刷整条 item。
  if (params.stdin === "" && previous.waitingForTerminal === true) return
  const inputs =
    params.stdin === ""
      ? (previous.terminalInputs ?? [])
      : [...(previous.terminalInputs ?? []), params.stdin]
  const item: WireItem = {
    ...previous,
    terminalInputs: inputs,
    waitingForTerminal: params.stdin === "",
  }
  ctx.inflight.set(params.itemId, item)
  if (!ctx.materialized.has(params.itemId)) return
  const output = ctx.streamed.get(params.itemId)
  const recovered = output === undefined ? item : { ...item, aggregatedOutput: output }
  const switchback = itemToSwitchback(recovered, { turnId, at: ctx.now() }, false)
  if (switchback !== undefined) ctx.emit({ type: "item.updated", at: ctx.now(), item: switchback })
}
