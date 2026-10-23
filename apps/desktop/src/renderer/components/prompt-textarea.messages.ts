import { defineMessages } from "@switchback/i18n"

/** 输入框的占位与读屏名。 */
export const PROMPT_TEXTAREA = defineMessages(
  {
    args: "输入参数（可选）",
    aside: "问一句不进正文的话…（Esc 退回普通发送）",
    starting: "引擎正在启动，起来就能发。",
    steering: "它还在跑——回车排队，⌘⏎ 直接插入当前轮次。",
    queueing: "它还在跑——回车排队，这一轮停下后发送。",
    idle: "交代任务…（可拖入文件，@ 搜索，/ 用命令）",
    task: "任务",
    argsOf: (name: string) => `${name} 的参数`,
  },
  {
    args: "Arguments (optional)",
    aside: "Ask a side question… (Esc to send normally)",
    starting: "The engine is starting. You can send once it's up.",
    steering: "Still running. Return queues your message; ⌘⏎ inserts it into the current turn.",
    queueing: "Still running. Return queues your message to send when this turn stops.",
    idle: "Describe a task… (drop in files, @ to search, / for commands)",
    task: "Task",
    argsOf: (name) => `Arguments for ${name}`,
  },
)
