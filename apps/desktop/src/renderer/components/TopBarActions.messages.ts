import { defineMessages } from "@switchback/i18n"

/** 顶栏右边那几颗键。 */
export const TOP_BAR_ACTIONS = defineMessages(
  {
    compareTip: (title: string) => `和「${title}」并排比一比（⇧⌘D）`,
    compare: "对比分叉",
    forkTip: (label: string) => `用 ${label} 另开一条同工作区分支（原会话保留，不自动发送内容）`,
    forkTo: (label: string) => `分叉到 ${label}`,
    hidePanelTip: "隐藏侧边面板（⌥⌘B）",
    showPanelTip: "显示侧边面板（⌥⌘B）",
    hidePanel: "隐藏侧边面板",
    showPanel: "显示侧边面板",
  },
  {
    compareTip: (title) => `Compare side by side with “${title}” (⇧⌘D)`,
    compare: "Compare forks",
    forkTip: (label) => `Open a parallel branch in this workspace with ${label} (this thread stays; nothing is sent)`,
    forkTo: (label) => `Fork to ${label}`,
    hidePanelTip: "Hide side panel (⌥⌘B)",
    showPanelTip: "Show side panel (⌥⌘B)",
    hidePanel: "Hide side panel",
    showPanel: "Show side panel",
  },
)
