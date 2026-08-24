import type { EngineInfo, ModelOption, Thread } from "@omni/protocol"
import type { ViewState } from "@omni/store"
import { BUILTIN_ENGINES } from "../shared/builtin-engines.js"
import { dshProfileConfirmed, type EnginePick, type LastUsed, type Settings } from "../shared/settings.js"

export interface EngineSettingItem extends EngineInfo {
  builtin: boolean
}

export interface EngineSettingState {
  label: string
  tone: "ok" | "warn" | "muted"
  hint: string
}

/** 内置五家始终在前；宿主注册的第三方 ACP 引擎跟在后面。 */
export function engineSettingItems(catalog: readonly EngineInfo[]): readonly EngineSettingItem[] {
  const byId = new Map(catalog.map((engine) => [engine.id, engine]))
  const builtins = BUILTIN_ENGINES.map((engine) => ({
    ...engine,
    ...byId.get(engine.id),
    builtin: true,
  }))
  const known = new Set<string>(BUILTIN_ENGINES.map((engine) => engine.id))
  const custom = catalog
    .filter((engine) => !known.has(engine.id))
    .map((engine) => ({ ...engine, builtin: false }))
  return [...builtins, ...custom]
}

/**
 * 每家拿最近活跃会话里最后一份非空清单。
 *
 * 清单是引擎运行时自己报的，不能写死；同一家在多条会话都报过时，最近那条最可能
 * 对应当前账号与当前版本。空清单不覆盖旧的非空清单——空也可能只是一次探测失败。
 */
export function engineModelCatalogs(
  state: Pick<ViewState, "models" | "order" | "threads">,
  dshProfile = "acp",
): Readonly<Record<string, readonly ModelOption[]>> {
  const out: Record<string, readonly ModelOption[]> = {}
  const ids = [...state.order].sort(
    (left, right) => (state.threads[right]?.updatedAt ?? 0) - (state.threads[left]?.updatedAt ?? 0),
  )
  for (const id of ids) {
    for (const [engine, models] of Object.entries(state.models[id] ?? {})) {
      const profile = dshProfileOf(state.threads[id])
      if (engine === "dsh" && profile !== dshProfile) continue
      if (out[engine] === undefined && models.length > 0) out[engine] = models
    }
  }
  return out
}

function dshProfileOf(thread: Thread | undefined): string {
  if (thread?.engine === "dsh") return thread.engineProfile ?? "acp"
  const segment = [...(thread?.segments ?? [])].reverse().find((entry) => entry.engine === "dsh")
  return segment?.profile ?? "acp"
}

/** 设置页人工改一家偏好时，不顺手把“上次用的引擎”也改掉。 */
export function withEnginePick(
  last: LastUsed,
  engine: string,
  pick: EnginePick | undefined,
): LastUsed {
  const rest = Object.fromEntries(
    Object.entries(last.byEngine).filter(([candidate]) => candidate !== engine),
  )
  const empty = pick?.model === undefined && pick?.effort === undefined
  return {
    ...last,
    byEngine: empty ? rest : { ...rest, [engine]: pick ?? {} },
  }
}

/** 打开设置时优先落到明写的默认，其次是上次用的，最后才是第一家。 */
export function initialEngine(
  items: readonly EngineSettingItem[],
  defaultEngine: string,
  lastEngine: string,
): string {
  const ids = new Set(items.map((item) => item.id))
  return [defaultEngine, lastEngine].find((id) => id !== "" && ids.has(id)) ?? items[0]?.id ?? ""
}

export function engineSettingState(
  item: EngineSettingItem,
  settings: Pick<Settings, "dsh">,
): EngineSettingState {
  const dsh = dshSettingState(item, settings.dsh)
  if (dsh !== undefined) return dsh
  if (item.state === "ok") {
    return { label: "可用", tone: "ok", hint: item.detail ?? "宿主已探测到这家引擎。" }
  }
  if (item.state === "missing") {
    return { label: "未安装", tone: "warn", hint: item.detail ?? "当前 PATH 中没有探测到它。" }
  }
  if (item.state === "unavailable") {
    return { label: "配置不可用", tone: "warn", hint: item.detail ?? "原生入口暂时不能启动。" }
  }
  return {
    label: item.state === "unknown" ? "未确认" : "等待探测",
    tone: "muted",
    hint: item.detail ?? "探测没有给出明确结论；omni 不会据此声称它不可用。",
  }
}

function dshSettingState(
  item: EngineSettingItem,
  dsh: Settings["dsh"],
): EngineSettingState | undefined {
  if (item.id !== "dsh") return undefined
  if (!dshProfileConfirmed(dsh)) {
    return { label: "未接入", tone: "muted", hint: "确认原生配置后才探测，也不会提前启动 DSH。" }
  }
  if (item.profile !== dsh.profile) {
    return { label: "等待探测", tone: "muted", hint: `正在探测 \`${dsh.profile}\` profile。` }
  }
  return undefined
}
