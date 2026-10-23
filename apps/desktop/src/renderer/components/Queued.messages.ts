import { count, defineMessages } from "@switchback/i18n"

/** 排队等发的那几句。 */
export const QUEUED = defineMessages(
  {
    images: (n: number) => `${String(n)} 张图片`,
    empty: "待发送内容",
    dropTip: "把这句话和它的附件取回输入框，先不发。正在跑的那一轮不受影响",
    insertTip: "不等这一轮跑完，现在就递进去",
    queued: "排队中",
    waiting: "待发送",
    insert: "立刻插入",
    insertAll: "全部插入",
    drop: "取回",
    dropAll: "全部取回",
    dropAllTip: "把排着的这几句全部取回输入框，按顺序拼成一段",
  },
  {
    images: (n) => count(n, "image"),
    empty: "Message waiting to send",
    dropTip: "Puts this message and its attachments back in the input without sending. The running turn isn't affected.",
    insertTip: "Send it in now, without waiting for this turn to finish",
    queued: "Queued",
    waiting: "Waiting",
    insert: "Insert now",
    insertAll: "Insert all",
    drop: "Take back",
    dropAll: "Take all back",
    dropAllTip: "Puts every queued message back in the input, joined in order",
  },
)
