import { defineMessages } from "@switchback/i18n"

/** 信任档落不到引擎的档位上时说的话。档位名是引擎报的，原样显示。 */
export const ACP_MODE = defineMessages(
  {
    noModes: (id: string) => `${id} 没有报告可选档位，Switchback 的信任档只在本机判定层生效。`,
    unmapped: (trust: string, id: string, names: readonly string[]) =>
      `Switchback 的「${trust}」档在 ${id} 的档位（${names.join("、")}）里找不到对应项，已保持引擎自己的默认档。`,
  },
  {
    noModes: (id) => `${id} didn't report any modes, so Switchback's trust tier only applies to its own approval checks on this machine.`,
    unmapped: (trust, id, names) =>
      `Switchback's “${trust}” tier has no match among ${id}'s modes (${names.join(", ")}), so the engine keeps its own default mode.`,
  },
)
