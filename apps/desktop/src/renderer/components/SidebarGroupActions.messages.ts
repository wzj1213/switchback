import { defineMessages } from "@switchback/i18n"

/** 项目行右边的两颗键。 */
export const GROUP_ACTIONS = defineMessages(
  { newIn: (where: string) => `在 ${where} 新建会话`, menu: "项目操作" },
  { newIn: (where) => `New thread in ${where}`, menu: "Project actions" },
)
