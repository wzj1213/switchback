import { defineMessages } from "@switchback/i18n"

/** ACP 接入的进度，与「退出登录」那一项的名字（它也是正在办的那一件的名字）。 */
export const USE_ACP = defineMessages(
  {
    logout: "退出登录",
    preparing: "准备中…",
    startDownload: "开始下载…",
    downloading: (received: string, total: string | undefined) => `下载中 ${received}${total === undefined ? "" : ` / ${total}`}`,
    extracting: "解包中…",
    trial: "握手试接中…（npx / uvx 第一次运行要先下载，可能要一两分钟）",
    writing: "写进 engines.json…",
  },
  {
    logout: "Sign out",
    preparing: "Preparing…",
    startDownload: "Starting download…",
    downloading: (received, total) => `Downloading ${received}${total === undefined ? "" : ` / ${total}`}`,
    extracting: "Unpacking…",
    trial: "Trying the handshake… (npx / uvx download on first run, which can take a minute or two)",
    writing: "Writing engines.json…",
  },
)
