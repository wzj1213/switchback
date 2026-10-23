import { defineMessages } from "@switchback/i18n"

/** 一家引擎自己读的配置文件。每一份的说明是主进程给的。 */
export const ENGINE_DOORS = defineMessages(
  {
    failed: "没能读取原生配置来源；可以稍后重开设置再试。",
    loading: "正在确认配置来源…",
    registry: "这家由 engines.json 接入；Switchback 不知道它自己的配置放在哪里。",
    exists: "已存在",
    missing: "尚未创建",
    edit: "编辑",
    revealPath: (path: string) => `在访达中显示 ${path}`,
    reveal: "在访达中显示",
    scope: { user: "用户级", project: "项目级", managed: "厂商维护" },
  },
  {
    failed: "Couldn't read the native config sources. Reopen Settings later to try again.",
    loading: "Checking config sources…",
    registry: "This engine was added through engines.json; Switchback doesn't know where its own config lives.",
    exists: "Exists",
    missing: "Not created yet",
    edit: "Edit",
    revealPath: (path) => `Show ${path} in Finder`,
    reveal: "Show in Finder",
    scope: { user: "User", project: "Project", managed: "Vendor-managed" },
  },
)
