import { defineMessages } from "@switchback/i18n"

/** 替人转达登录、退出登录时可能出的岔子。它自己报的错原样接在后面。 */
export const ACP_LOGIN = defineMessages(
  {
    timeout: "等了五分钟还没办完，已放弃。浏览器那边没走完的话，再点一次「登录」。",
    failed: (message: string) => `它没办成：${message}`,
    loginHandshake: "它 30 秒内没有完成握手，没法登录。先点「试接」看看它还起不起得来。",
    noMethod: (id: string) => `它这一次没有报「${id}」这种登录方式。点「试接」重新看看它现在认哪几种。`,
    terminalOnly: "这一种要在终端里登录，不能直接转给它。",
    logoutHandshake: "它 30 秒内没有完成握手，没法退出登录。",
    noLogout: "它没有声明支持退出登录，只能照它自己的文档来。",
  },
  {
    timeout: "Gave up after five minutes without it finishing. If the browser part isn't done, pick the sign-in method again.",
    failed: (message) => `It didn't work: ${message}`,
    loginHandshake: "It didn't finish the handshake within 30 seconds, so it can't sign in. Click “Try” first to see whether it still starts.",
    noMethod: (id) => `It didn't report the “${id}” sign-in method this time. Click “Try” to see which ones it accepts now.`,
    terminalOnly: "This one signs in from a terminal, so it can't be handed to the engine directly.",
    logoutHandshake: "It didn't finish the handshake within 30 seconds, so it can't sign out.",
    noLogout: "It doesn't declare sign-out support; follow its own docs instead.",
  },
)
