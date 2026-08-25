import type { ModelOption } from "@omni/protocol"
import type { RpcPeer } from "../rpc.js"
import { toModelOption, type WireModel } from "./catalog.js"

interface ModelPage {
  data?: readonly WireModel[]
  nextCursor?: unknown
}

/** 逐页读取引擎目录；游标重复时停下，避免坏服务端让设置页永远转圈。 */
export async function readModelCatalog(call: RpcPeer["call"]): Promise<readonly ModelOption[]> {
  const rows: WireModel[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  do {
    const raw = await call("model/list", {
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    }) as ModelPage
    rows.push(...(raw.data ?? []))
    const next = typeof raw.nextCursor === "string" && raw.nextCursor !== ""
      ? raw.nextCursor
      : undefined
    if (next === undefined || cursors.has(next)) break
    cursors.add(next)
    cursor = next
  } while (cursor !== undefined)
  const seen = new Set<string>()
  return rows
    .filter((row) => row.hidden !== true)
    .map(toModelOption)
    .filter((option) => {
      if (option.id === "" || seen.has(option.id)) return false
      seen.add(option.id)
      return true
    })
}

/** 目录说得出合法档位时按目录收口；目录未到时保留用户明确请求，不猜默认值。 */
export function modelSelection(
  options: readonly ModelOption[],
  model: string,
  requested: string | undefined,
): { model: string; effort: string | undefined } {
  const option = options.find((candidate) => candidate.id === model)
  if (option === undefined) return { model, effort: requested }
  const efforts = option.efforts ?? []
  const effort = requested !== undefined && efforts.includes(requested)
    ? requested
    : option.defaultEffort
  return { model, effort }
}
