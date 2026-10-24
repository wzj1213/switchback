import { defineMessages } from "@switchback/i18n"

/** 会话跑着时降级、崩溃的那几句。Kimi 报的错原样附上。 */
export const KIMI_SESSION = defineMessages(
  {
    interactionFailed: (message: string) => `Kimi 交互请求应答失败：${message}`,
    streamDead: (message: string) => `Kimi 的实时连接重试多次都没接上：${message}`,
    action: { trust: "权限切换", models: "模型清单加载", model: "模型切换" },
    readback: (action: string, error: string) => `Kimi ${action}已完成，但状态读回失败：${error}`,
  },
  {
    interactionFailed: (message) => `Couldn't answer Kimi's interaction request: ${message}`,
    streamDead: (message) => `Kimi's live connection couldn't be restored after several retries: ${message}`,
    action: { trust: "the trust tier change", models: "loading the model list", model: "the model switch" },
    readback: (action, error) => `Kimi finished ${action}, but reading its status back failed: ${error}`,
  },
)
