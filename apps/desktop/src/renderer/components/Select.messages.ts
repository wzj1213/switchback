import { defineMessages } from "@switchback/i18n"

/** 下拉选择器的触发器与第一层。 */
export const SELECT = defineMessages(
  {
    spoken: (name: string, value: string) => `${name}：${value}`,
    options: "选项",
    fallback: "默认",
  },
  {
    spoken: (name, value) => `${name}: ${value}`,
    options: "Options",
    fallback: "Default",
  },
)
