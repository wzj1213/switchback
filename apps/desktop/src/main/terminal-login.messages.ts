import { defineMessages } from "@switchback/i18n"

/**
 * 「终端」里登录脚本说的几句，以及打不开终端时那一句。
 * `exited` 里的 `$code` 是留给 shell 展开的变量，两种语言都要原样带着，也不能出现双引号。
 */
export const TERMINAL_LOGIN = defineMessages(
  {
    intro: (label: string) => `Switchback：下面是 ${label} 自己的登录流程。走完之后回到 Switchback，点「试接」确认。`,
    done: "登录流程已结束。可以关掉这个窗口，回到 Switchback。",
    exited: "登录流程以 $code 退出。",
    openFailed: (error: string) => `没能打开「终端」：${error}`,
  },
  {
    intro: (label) => `Switchback: what follows is ${label}'s own sign-in flow. When you're done, return to Switchback and click “Try” to confirm.`,
    done: "The sign-in flow has finished. You can close this window and return to Switchback.",
    exited: "The sign-in flow exited with code $code.",
    openFailed: (error) => `Couldn't open Terminal: ${error}`,
  },
)
