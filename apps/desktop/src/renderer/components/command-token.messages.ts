import { defineMessages } from "@switchback/i18n"

/** 输入框里选中的那条原生命令。 */
export const COMMAND_TOKEN = defineMessages(
  {
    title: (name: string) => `原生命令 /${name}；点击移除`,
    label: (label: string) => `已选择 ${label}；点击移除`,
  },
  {
    title: (name) => `Engine command /${name}. Click to remove.`,
    label: (label) => `${label} selected. Click to remove.`,
  },
)
