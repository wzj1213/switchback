import { defineMessages } from "@switchback/i18n"

/** 实时连接断了、正在接回时那一句。关闭码与对面给的理由原样附上。 */
export const KIMI_DISCONNECT = defineMessages(
  {
    note: (said: string) => `（${said}）`,
    closed: (note: string) => `Kimi 的实时连接断了${note}，正在接回`,
    resync: (by: "switchback" | "kimi") =>
      `Kimi 的实时流要重新同步（${by === "switchback" ? "Switchback 发现流里有缺口" : "服务端要求重新同步"}），正在按会话快照接回`,
    error: (message: string) => `Switchback 处理 Kimi 推来的消息时出错（${message}），正在按会话快照接回`,
  },
  {
    note: (said) => ` (${said})`,
    closed: (note) => `Kimi's live connection dropped${note}; reconnecting`,
    resync: (by) =>
      `Kimi's live stream needs a resync (${by === "switchback" ? "Switchback found a gap in the stream" : "the server asked for one"}); reconnecting from the thread snapshot`,
    error: (message) => `Switchback hit an error handling a message from Kimi (${message}); reconnecting from the thread snapshot`,
  },
)
