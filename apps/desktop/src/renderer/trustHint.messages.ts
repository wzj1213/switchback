import { defineMessages } from "@switchback/i18n"

/** 档位下面那一行说明，和档位选择器悬停上那句「这家不报」。措辞的来由见 `trustHint.ts`。 */
export const TRUST_HINT = defineMessages(
  {
    diverged: (engine: string, axis: string, trust: string) =>
      `权限档不一致：${engine} 在「${axis}」，Switchback 这条会话是「${trust}」。`,
    divergedTip: (engine: string, trust: string) =>
      `不是 Switchback 切的——引擎那边被改过。Switchback 的审批层不吃引擎的档：` +
      `它仍按「${trust}」判定，红线动作（工作区外的删除、读凭据、推远端…）` +
      `任何档位下都要问过你。右边那颗键把 Switchback 的档重新推给 ${engine}。`,
    reapply: (trust: string) => `改回「${trust}」`,
    fixed: (engine: string) => `${engine} 的档位在开会话时就定死了，换档要重开一条会话。`,
    unmapped: (engine: string) => `这一档在 ${engine} 上只在 Switchback 本机判定层生效。`,
    blind: (engine: string) => `${engine} 不会把它自己改的档位告诉 Switchback；这里显示的是 Switchback 让它去的那一档。`,
  },
  {
    diverged: (engine, axis, trust) =>
      `Permission tiers don't match: ${engine} is on “${axis}”, and this thread in Switchback is on “${trust}”.`,
    divergedTip: (engine, trust) =>
      `Switchback didn't change this; it was changed on the engine's side. Switchback's approvals ignore the engine's tier: ` +
      `they still go by “${trust}”, and red-line actions (deleting outside the workspace, reading credentials, pushing to a remote…) ` +
      `ask you first at any tier. The button on the right sends Switchback's tier to ${engine} again.`,
    reapply: (trust) => `Set back to “${trust}”`,
    fixed: (engine) => `${engine} fixes its tier when the thread starts. To change it, start a new thread.`,
    unmapped: (engine) => `On ${engine}, this tier only applies to Switchback's own approval checks on this Mac.`,
    blind: (engine) => `${engine} doesn't tell Switchback when it changes its own tier. This shows the tier Switchback asked it to use.`,
  },
)
