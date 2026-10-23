import { defineMessages } from "@switchback/i18n"

/** 设置里「新会话沿用哪个模型与思考档」那颗选择器。 */
export const ENGINE_PREFERENCE = defineMessages(
  {
    tip: "新会话沿用的模型与思考档",
    engineDefault: "跟随引擎默认",
    engineDefaultNote: "不向新会话指定模型或思考档",
    notReported: "本次未报告",
    model: "模型",
    effort: "思考档",
  },
  {
    tip: "Model and reasoning level for new threads",
    engineDefault: "Engine default",
    engineDefaultNote: "Don't set a model or reasoning level for new threads",
    notReported: "Not reported this time",
    model: "Model",
    effort: "Reasoning level",
  },
)
