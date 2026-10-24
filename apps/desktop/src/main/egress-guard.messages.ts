import { defineMessages } from "@switchback/i18n"

/** 外发守卫报警时写进转录区的那段话。地址、主机名、引擎名原样显示。 */
export const EGRESS = defineMessages(
  {
    peer: (address: string, host: string | undefined) => (host === undefined ? address : `${address}（${host}）`),
    zcode: "单独开着的 ZCode",
    peers: (list: readonly string[]) => `当时它连着：${list.join("、")}。`,
    zcodeWhy: "ZCode 3.14.0 之前的版本会在后台把整个工作区连同 .git 历史打包上传。",
    engineWhy: "正常对话一次请求通常不到 1 MB，这个量更像是在把整个工作区往外传。",
    quitZcode: "要停就退出 ZCode。",
    closeThread: "要停就关掉这条会话。",
    stopped: "Switchback 已经停掉了它。确认是你让它传的，可以在「设置 → 数据与排查」里关掉「批量外发时停掉」。",
    notStopped: (keep: string) => `「批量外发时停掉」关着，Switchback 没有停它；${keep}`,
    detail: (who: string, mb: string, parts: readonly string[]) =>
      `${who} 一分钟内自己往本机外面发了 ${mb} MB（不算它跑的命令）。${parts.join("")}`,
  },
  {
    peer: (address, host) => (host === undefined ? address : `${address} (${host})`),
    zcode: "ZCode (running on its own)",
    peers: (list) => `At the time it was connected to: ${list.join(", ")}.`,
    zcodeWhy: "ZCode versions before 3.14.0 upload the whole workspace, .git history included, in the background.",
    engineWhy: "A normal conversation request is usually under 1 MB; this much looks more like the whole workspace being sent out.",
    quitZcode: "To stop it, quit ZCode.",
    closeThread: "To stop it, close this thread.",
    stopped: "Switchback stopped it. If you did ask it to send this, you can turn off “Stop on bulk uploads” in Settings → Data & troubleshooting.",
    notStopped: (keep) => `“Stop on bulk uploads” is off, so Switchback didn't stop it. ${keep}`,
    detail: (who, mb, parts) =>
      [`${who} sent ${mb} MB off this Mac by itself within a minute (not counting commands it ran).`, ...parts].join(" "),
  },
)
