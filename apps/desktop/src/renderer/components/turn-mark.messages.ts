import { defineMessages } from "@switchback/i18n"

/** 分界线上那句「这一轮花了多久」。 */
export const TURN_MARK = defineMessages(
  {
    worked: (time: string) => `已处理 ${time}`,
    paceTip:
      "首字：这一轮开跑，到模型第一次有输出。" +
      "速度：生成量 ÷ 真在出字的时间——工具在跑、下一次请求在等首字的那些空档都不算。" +
      "带 ≈ 的是引擎没报生成量，按写出来的字估的。",
  },
  {
    worked: (time) => `Worked for ${time}`,
    paceTip:
      "First token: from the start of this turn to the model's first output. " +
      "Speed: tokens generated ÷ time spent actually writing; gaps while tools run or the next request waits for its first token don't count. " +
      "Values marked ≈ are estimated from the text, because the engine didn't report token counts.",
  },
)
