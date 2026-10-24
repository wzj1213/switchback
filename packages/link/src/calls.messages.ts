import { defineMessages } from "@switchback/i18n"

/** 一条宿主调用没等到回话时说的话。被拒的理由是宿主给的原话。 */
export const CALLS = defineMessages(
  {
    timeout: (seconds: number) => `等了 ${String(seconds)} 秒，那台机器没有回音`,
    dropped: (reason: string) => `连接断了（${reason}），这一下没有做完`,
  },
  {
    timeout: (seconds) => `Waited ${String(seconds)}s with no reply from the host machine`,
    dropped: (reason) => `The connection dropped (${reason}) before this finished`,
  },
)
