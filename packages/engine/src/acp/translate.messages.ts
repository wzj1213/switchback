import { defineMessages } from "@switchback/i18n"

/** 一轮撞墙停下时附的解释（`stopReason`）。 */
export const ACP_STOP = defineMessages(
  {
    maxTokens: "模型输出达到长度上限，这一轮没说完就停了。",
    maxTurnRequests: "达到单轮内的请求次数上限，引擎主动停手了。",
    refusal: "引擎拒绝了这一轮。**这条提问和它之后的内容不会进入下一次请求**——界面上还看得见，但模型已经不记得了。",
  },
  {
    maxTokens: "The model hit its output length limit, so this turn stopped before it finished.",
    maxTurnRequests: "The turn hit its request limit, so the engine stopped on its own.",
    refusal: "The engine refused this turn. **This prompt and everything after it won't be part of the next request**: you can still see it here, but the model no longer remembers it.",
  },
)
