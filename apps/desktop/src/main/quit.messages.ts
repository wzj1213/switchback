import { count, defineMessages } from "@switchback/i18n"

/** 还有活没跑完时，退出前问的那一句。 */
export const QUIT = defineMessages(
  {
    running: (n: number) => `${String(n)} 条正在跑`,
    waiting: (n: number) => `${String(n)} 条等着你批`,
    questions: (n: number) => `${String(n)} 组等着你回答`,
    blurb: (parts: readonly string[]) => `${parts.join("、")}。现在退出会结束它们手上的活，改到一半的文件就停在那儿了。`,
    quit: "退出",
    cancel: "取消",
    title: "还有活没跑完",
  },
  {
    running: (n) => `${count(n, "thread")} running`,
    waiting: (n) => `${String(n)} waiting for your approval`,
    questions: (n) => `${count(n, "set of questions", "sets of questions")} waiting for your answer`,
    blurb: (parts) => `${parts.join(", ")}. Quitting now stops their work, and any half-edited files stay as they are.`,
    quit: "Quit",
    cancel: "Cancel",
    title: "Some work isn't finished",
  },
)
