import type { Trust } from "@switchback/protocol"
import type { Locale } from "@switchback/i18n"
import { TRUSTS } from "./trusts.messages.js"

export interface TrustOption {
  id: Trust
  label: string
  hint: string
}

/**
 * 信任档，按从窄到宽排（为什么叫这几个名字，见 `trusts.messages.ts`）。
 *
 * 档位 id 不动（历史 journal 仍然读得回来）；各家底层不完全同型，具体行为仍由
 * 它们正式暴露的权限入口决定，Switchback 不拿自己的静态判断冒充引擎原生自动审批。
 * 输入框的选择器、设置里的默认档、侧栏悬停卡用的都是这一份，名字才逐字一致。
 */
const ORDER: readonly Trust[] = ["read-only", "auto-edit", "full"]

export function trustsOf(locale: Locale): readonly TrustOption[] {
  const m = TRUSTS[locale]
  return ORDER.map((id) => ({ id, label: m.label[id], hint: m.hint[id] }))
}
