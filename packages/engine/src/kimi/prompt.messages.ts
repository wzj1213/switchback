import { defineMessages } from "@switchback/i18n"

/** 发一句话、插一句话没成的几种情况。 */
export const KIMI_PROMPT = defineMessages(
  {
    empty: "Kimi 的提示内容不能为空",
    notStarted: (status: string) => `Kimi 没有开始这一轮（状态：${status}）`,
    noTurn: "Kimi 没有正在运行的轮次，无法改向",
    missed: "Kimi 的上一轮刚好已经结束，这句话改为排队发送",
  },
  {
    empty: "The message to Kimi can't be empty",
    notStarted: (status) => `Kimi didn't start this turn (status: ${status})`,
    noTurn: "Kimi has no turn running, so it can't be steered",
    missed: "Kimi's previous turn just ended, so this message is queued instead",
  },
)
