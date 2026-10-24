import { defineMessages } from "@switchback/i18n"

/** 侧问发不出去的理由。 */
export const ENGINE_STATE = defineMessages(
  {
    switching: "会话正在切换或重启，暂时不能侧问",
    noAside: (engine: string) => `${engine} 不支持侧问`,
  },
  {
    switching: "The thread is switching or restarting, so side questions aren't available right now",
    noAside: (engine) => `${engine} doesn't support side questions`,
  },
)
