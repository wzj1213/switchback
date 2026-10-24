import { defineMessages } from "@switchback/i18n"

/** 试接、登录、退出登录这几件「起一次进程办一件事」共用的话。 */
export const ACP_ONESHOT = defineMessages(
  {
    cancelled: "已取消。",
    noAnswer: (seconds: number) =>
      `${String(seconds)} 秒内没有回应。它可能不讲 ACP，或者要换一组参数才进 ACP 模式（有几家是 \`<命令> acp\` 或 \`<命令> agent stdio\`）。`,
    tooNew: (version: number, supported: number) =>
      `它讲的是 ACP v${String(version)}，Switchback 只认到 v${String(supported)}。请升级 Switchback。`,
  },
  {
    cancelled: "Cancelled.",
    noAnswer: (seconds) =>
      `No answer within ${String(seconds)} seconds. It may not speak ACP, or it may need different arguments to enter ACP mode (some use \`<command> acp\` or \`<command> agent stdio\`).`,
    tooNew: (version, supported) =>
      `It speaks ACP v${String(version)}, but Switchback only supports up to v${String(supported)}. Update Switchback.`,
  },
)
