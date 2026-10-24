import { defineMessages } from "@switchback/i18n"

/** 从注册表接一家时可能卡在哪一步。试接自己说的那句原样放在前面。 */
export const ACP_CONNECT = defineMessages(
  {
    trialFailed: "试接失败。",
    firstRun: (said: string, kind: string, pkg: string, line: string) =>
      `${said}第一次运行时 ${kind} 要先下载 ${pkg}，网络慢时会超过三分钟：可以先在终端里跑一次 \`${line}\` 让它下载完，再回来点「接入」。`,
    cantWrite: "写不进 engines.json。",
    gone: "注册表里已经没有这一家了，点「刷新」再看看。",
    noRun: "这台机器上起不了它",
    cantRun: (missing: string) => `${missing}。`,
  },
  {
    trialFailed: "The trial failed.",
    firstRun: (said, kind, pkg, line) =>
      `${said} The first run makes ${kind} download ${pkg}, which can take over three minutes on a slow network. Run \`${line}\` once in a terminal to let it finish downloading, then come back and click “Connect”.`,
    cantWrite: "Couldn't write to engines.json.",
    gone: "This one is no longer in the registry. Click “Refresh” to check again.",
    noRun: "It can't run on this machine",
    cantRun: (missing) => `${missing}.`,
  },
)
