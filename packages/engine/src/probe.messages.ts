import { defineMessages } from "@switchback/i18n"

/** 设置页引擎卡片上「装了没有、能不能用」那句。路径与版本原样显示。 */
export const PROBE = defineMessages(
  {
    missing: (command: string) => `\`${command}\` 不在 PATH 上。`,
    many: (paths: readonly string[]) => `PATH 上 ${String(paths.length)} 个同名文件（${paths.join("、")}）`,
    firstBroken: "PATH 上靠前的那个先被用到，坏的多半是它；后面几个可能好好的。",
    broken: (tried: string) => `${tried} 都跑不起来 \`--version\`——装坏了、版本不兼容，或者那只是个空壳。`,
    join: (parts: readonly string[]) => parts.join(""),
  },
  {
    missing: (command) => `\`${command}\` isn't on PATH.`,
    many: (paths) => `${String(paths.length)} files with this name on PATH (${paths.join(", ")})`,
    firstBroken: "The one earlier on PATH is used first, so it's most likely the broken one; the later ones may be fine.",
    broken: (tried) => `${tried} can't run \`--version\`: the install is broken, the version is incompatible, or it's just an empty shell.`,
    join: (parts) => parts.join(" "),
  },
)
