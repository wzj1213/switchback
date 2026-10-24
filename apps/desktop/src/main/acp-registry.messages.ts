import { defineMessages } from "@switchback/i18n"

/** 取不到 ACP 注册表时那一句，以及接下来给你看的是哪一份。 */
export const ACP_REGISTRY = defineMessages(
  {
    http: (status: number) => `注册表返回 HTTP ${String(status)}`,
    tooBig: "注册表大得不正常，没有采用",
    slow: "15 秒内没取到",
    unreachable: (reason: string) => `取不到 ACP 注册表（${reason}）`,
    offline: (why: string) => `${why}。联网后点「刷新」再试。`,
    cached: (why: string) => `${why}，下面是本机存的那份。`,
  },
  {
    http: (status) => `The registry returned HTTP ${String(status)}`,
    tooBig: "The registry is abnormally large, so it wasn't used",
    slow: "nothing arrived within 15 seconds",
    unreachable: (reason) => `Couldn't fetch the ACP registry (${reason})`,
    offline: (why) => `${why}. Connect to the internet and click “Refresh” to try again.`,
    cached: (why) => `${why}; showing the copy saved on this machine.`,
  },
)
