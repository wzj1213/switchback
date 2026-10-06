import type { SlashCommand, ThreadId } from "@switchback/protocol"
import type { StartRequest } from "../contract.js"
import type { RpcPeer } from "../rpc.js"
import { skillsToCommands } from "./catalog.js"

export interface SkillCatalog {
  list: () => Promise<readonly SlashCommand[]>
  changed: () => void
  close: () => void
}

interface SkillCatalogDeps {
  call: RpcPeer["call"]
  emit: StartRequest["emit"]
  cwd: string
  threadId: ThreadId
}

interface CatalogState {
  version: number
  closed: boolean
}

/** `skills/changed` 只是失效信号；权威清单仍要重新问 `skills/list`。 */
export function createSkillCatalog(deps: SkillCatalogDeps): SkillCatalog {
  const state: CatalogState = { version: 0, closed: false }

  const query = async (forceReload: boolean): Promise<readonly SlashCommand[] | undefined> => {
    const raw = await deps.call("skills/list", {
      cwds: [deps.cwd],
      ...(forceReload ? { forceReload: true } : {}),
    }).catch(() => undefined)
    return raw === undefined ? undefined : skillsToCommands(raw)
  }

  const list = async (): Promise<readonly SlashCommand[]> => {
    const version = state.version
    const commands = await query(false)
    return state.closed || version !== state.version || commands === undefined ? [] : commands
  }

  const changed = (): void => {
    const version = ++state.version
    void query(true).then((commands) => {
      if (state.closed || version !== state.version || commands === undefined) return
      deps.emit({
        type: "commands.updated",
        at: Date.now(),
        threadId: deps.threadId,
        engine: "codex",
        commands,
      })
    })
  }

  const close = (): void => {
    state.closed = true
    state.version += 1
  }

  return { list, changed, close }
}
