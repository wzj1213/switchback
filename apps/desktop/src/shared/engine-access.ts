import { dshProfileConfirmed, type Settings } from "./settings.js"

/** 判定接入只要这两项；传整份 `Settings` 会把测试和调用方都绑死在别的字段上。 */
export type EngineAccess = Pick<Settings, "dsh" | "disabledEngines">

/**
 * 一家引擎是否被用户接入 omni。
 *
 * 两道闸门，**顺序有意义**：
 *
 * 1. `disabledEngines`——**用户自己关的**。这一条在最前面：它是明确的意愿，
 *    不该被任何探测结论翻案。关掉的那家连探测都不起。
 * 2. DSH 的接入确认——**它那边配好了没有**。ACP 的 initialize 不公开凭证是否就绪，
 *    所以不能拿一次握手冒充可运行，只能由用户替它作证。
 *
 * 两者不能压成一个开关：「我不用这家」和「这家没配好」在界面上要分得出来，
 * 否则用户关掉一家之后就再也说不清自己当初关它是因为什么。
 */
export function engineEnabled(settings: EngineAccess, id: string): boolean {
  if (settings.disabledEngines.includes(id)) return false
  return id !== "dsh" || dshProfileConfirmed(settings.dsh)
}

/** 同一条判据同时给宿主、桌面渲染层用，避免切开关时两边短暂说两套话。 */
export function enabledEngines<T extends { id: string }>(
  settings: EngineAccess,
  engines: readonly T[],
): readonly T[] {
  return engines.filter((engine) => engineEnabled(settings, engine.id))
}

/**
 * 把一家引擎切到开或关，返回新的 `disabledEngines`。
 *
 * 只动这一个字段：`dsh.confirmedProfiles` 记的是**另一件事**（它那边配好了没有），
 * 关掉 DSH 不该把那份证词一起擦掉——再打开时用户还得重新确认一次原生配置，
 * 而他什么都没改过。
 */
export function withEngineEnabled(
  disabled: readonly string[],
  id: string,
  on: boolean,
): readonly string[] {
  const rest = disabled.filter((candidate) => candidate !== id)
  return on ? rest : [...rest, id]
}

/**
 * 关掉最后一家会让这个应用**什么都开不了**。
 *
 * 挡在这里而不是在 parse 里悄悄纠正：偏好文件是用户改得到的，
 * 而「我把它们全关了，omni 自作主张又打开一家」比空清单更让人迷惑。
 * 界面据此把最后那一家的开关变灰，并说清楚为什么。
 */
export function lastEnabledEngine(
  settings: EngineAccess,
  ids: readonly string[],
): string | undefined {
  const on = ids.filter((id) => engineEnabled(settings, id))
  return on.length === 1 ? on[0] : undefined
}
