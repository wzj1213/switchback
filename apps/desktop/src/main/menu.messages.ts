import { defineMessages } from "@switchback/i18n"

/**
 * 应用菜单里 Switchback 自己手写的那几栏。英文照 macOS 菜单的惯例用标题式大小写。
 * 「编辑」「窗口」以及各栏里的系统项（撤销、缩放、全屏…）是 `role`，由系统本地化，不在这里。
 */
export const MENU = defineMessages(
  {
    file: "文件",
    newThread: "新建会话",
    settings: "设置",
    filterThreads: "筛选会话",
    openFolder: "打开文件夹…",
    engineRegistry: "引擎注册表…",
    thread: "会话",
    find: "在会话中查找",
    copyMarkdown: "复制会话为 Markdown",
    compare: "对比分叉",
    review: "审核改动",
    pickup: "承接上一段引擎记录",
    interrupt: "中断当前轮次",
    view: "显示",
    toggleRail: "收起 / 展开侧栏",
    togglePanel: "收起 / 展开侧边面板",
    checkUpdate: "检查更新…",
    diagnose: "导出诊断报告…",
  },
  {
    file: "File",
    newThread: "New Thread",
    settings: "Settings",
    filterThreads: "Filter Threads",
    openFolder: "Open Folder…",
    engineRegistry: "Engine Registry…",
    thread: "Thread",
    find: "Find in Thread",
    copyMarkdown: "Copy Thread as Markdown",
    compare: "Compare Forks",
    review: "Review Changes",
    pickup: "Pick Up the Previous Engine's Log",
    interrupt: "Interrupt Current Turn",
    view: "View",
    toggleRail: "Show or Hide Sidebar",
    togglePanel: "Show or Hide Side Panel",
    checkUpdate: "Check for Updates…",
    diagnose: "Export Diagnostic Report…",
  },
)

export type MenuText = (typeof MENU)["zh-CN"]
