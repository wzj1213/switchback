import { defineMessages } from "@switchback/i18n"

/** 斜杠命令列表的分段与作用域。命令名与说明是引擎报的，不翻译。 */
export const SLASH_LIST = defineMessages(
  {
    section: { engine: "技能", switchback: "Switchback" },
    scope: { user: "个人", project: "项目", system: "系统" },
  },
  {
    section: { engine: "Skills", switchback: "Switchback" },
    scope: { user: "Personal", project: "Project", system: "System" },
  },
)
