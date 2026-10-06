import { useCallback, useMemo } from "react"
import type { Command, Item } from "@switchback/protocol"
import type { ResolveApproval } from "./components/Approval.js"

function latestPending(items: readonly Item[], turnId: string | undefined): string | undefined {
  if (turnId === undefined) return undefined
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === "approval" && item.status === "pending" && item.turnId === turnId) return item.id
  }
  return undefined
}

/** 当前可裁决的轮次、独占快捷键的最新审批，以及稳定的命令出口。 */
export function useApprovalState(
  items: readonly Item[],
  turnId: string | undefined,
  send: (command: Command) => void,
): { turnId: string | undefined; shortcut: string | undefined; resolve: ResolveApproval } {
  const shortcut = useMemo(() => latestPending(items, turnId), [items, turnId])
  const resolve = useCallback<ResolveApproval>(
    (itemId, allow, remember, passTurn) => {
      send({
        type: "approval.resolve",
        itemId,
        allow,
        remember,
        ...(passTurn === true ? { passTurn } : {}),
      })
    },
    [send],
  )
  return { turnId, shortcut, resolve }
}
