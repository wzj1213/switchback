import type { EngineInfo, ModelOption, Thread } from "@switchback/protocol"
import type { ViewState } from "@switchback/store"
import { BUILTIN_ENGINES } from "../shared/builtin-engines.js"
import type { EngineAccess } from "../shared/engine-access.js"
import { dshProfileConfirmed, type EnginePick, type LastUsed } from "../shared/settings.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { ENGINE_STATE } from "./engine-settings-model.messages.js"

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
  settings: EngineAccess,
  locale: Locale = DEFAULT_LOCALE,
): EngineSettingState {
  const m = ENGINE_STATE[locale]
  // **用户自己关的排在最前面。** 一家被关掉的引擎连探测都不起，那时候还去报
  // 「未安装」或者「可用」，说的都是一个 Switchback 此刻根本没去问过的事
  if (settings.disabledEngines.includes(item.id)) {
    return { label: m.off, tone: "muted", hint: m.offHint }
  }
  const dsh = dshSettingState(item, settings.dsh, m)
  if (dsh !== undefined) return dsh
  if (item.state === "ok") {
    return { label: m.ok, tone: "ok", hint: item.detail ?? m.okHint }
  }
  if (item.state === "missing") {
    return { label: m.missing, tone: "warn", hint: item.detail ?? m.missingHint }
  }
  if (item.state === "unavailable") {
    /*
     * **「起不来」而不是「配置不可用」。**
     *
     * 这一档现在有两种成因：DSH 的 profile 名不对（确实是配置问题），
     * 以及**文件在 PATH 上但跑不起来**（`probeCommand` 新归到这一档——
     * 空壳、装坏了、架构不对）。后者跟配置没关系，说「配置不可用」
     * 会把人支到一个没问题的地方去。
     *
     * 两种成因共有的只有一件事：它在，但起不来。那就说这句。
     * 具体是哪一种由 `detail` 说——它一直是照实写的。
     */
    return { label: m.broken, tone: "warn", hint: item.detail ?? m.brokenHint }
  }
  return { label: item.state === "unknown" ? m.unknown : m.waiting, tone: "muted", hint: item.detail ?? m.unsureHint }
}

function dshSettingState(
  item: EngineSettingItem,
  dsh: EngineAccess["dsh"],
  m: (typeof ENGINE_STATE)[Locale],
): EngineSettingState | undefined {
  if (item.id !== "dsh") return undefined
  if (!dshProfileConfirmed(dsh)) return { label: m.dshOff, tone: "muted", hint: m.dshOffHint }
  if (item.profile !== dsh.profile) return { label: m.waiting, tone: "muted", hint: m.dshProbing(dsh.profile) }
  return undefined
}
