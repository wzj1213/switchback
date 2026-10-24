import { defineMessages } from "@switchback/i18n"

/** 「指一个可执行文件」那条路：选文件的框，以及起不出名字时那一句。 */
export const ENGINE_SETTINGS = defineMessages(
  {
    pickTitle: "选一个 ACP 适配器的可执行文件",
    badName: "这个名字里没有能当 id 用的字符，换一个。",
  },
  {
    pickTitle: "Choose an ACP adapter executable",
    badName: "This name has no characters usable as an id. Try another.",
  },
)
