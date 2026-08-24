import { dshProfileConfirmed, type Settings } from "./settings.js"

/**
 * 一家引擎是否被用户接入 omni。
 *
 * 目前只有 DSH 需要显式确认：它的 ACP 握手不报告 provider/model/凭证是否就绪。
 * 其他内置引擎沿用原有的原生探测，不在这里悄悄改变可见性。
 */
export function engineEnabled(settings: Pick<Settings, "dsh">, id: string): boolean {
  return id !== "dsh" || dshProfileConfirmed(settings.dsh)
}

/** 同一条判据同时给宿主、桌面渲染层用，避免切开关时两边短暂说两套话。 */
export function enabledEngines<T extends { id: string }>(
  settings: Pick<Settings, "dsh">,
  engines: readonly T[],
): readonly T[] {
  return engines.filter((engine) => engineEnabled(settings, engine.id))
}
