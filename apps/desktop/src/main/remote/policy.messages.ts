import { defineMessages } from "@switchback/i18n"

/** 远程档位上限钳住一条命令时，回给那台设备的说明。档位照原样显示 id。 */
export const REMOTE_POLICY = defineMessages(
  {
    sessionOnly: "远程批准只记到本会话；要记成项目级规则请在桌面上勾",
    unknownTrust: "远程查不到这条会话开在哪一档（可能已经删了），这一下没有执行。",
    aboveLimit: (target: string, ceiling: string) =>
      `这条会话开在 ${target} 档，高过远程上限 ${ceiling}。先在手机上把它切到 ${ceiling}（切低是允许的），或者在桌面上调高远程上限。`,
    adoptReadOnly: "远程上限是只读，而接管过来的会话固定开在自动审批档，所以这一步只能在桌面上做",
    createdAt: (trust: string) => `远程新建的会话按 ${trust} 开（上限）`,
    cappedAt: (trust: string) => `远程最高只能切到 ${trust}`,
  },
  {
    sessionOnly: "Approvals from remote are remembered for this thread only. To save a project rule, check it on the desktop",
    unknownTrust: "Remote can't tell which tier this thread runs at (it may have been deleted), so this wasn't run.",
    aboveLimit: (target, ceiling) =>
      `This thread runs at ${target}, above the remote limit ${ceiling}. Switch it to ${ceiling} on the phone first (lowering is allowed), or raise the remote limit on the desktop.`,
    adoptReadOnly: "The remote limit is read-only, and adopted threads always start at auto-edit, so this step can only be done on the desktop",
    createdAt: (trust) => `Threads created remotely start at ${trust} (the limit)`,
    cappedAt: (trust) => `Remote can switch to ${trust} at most`,
  },
)
