import { defineMessages } from "@switchback/i18n"

/** 远程连接上，宿主让客户端重来、或者没执行一条命令时说的话。 */
export const REMOTE_SESSION = defineMessages(
  {
    resultTooBig: "结果太大，远程传不过来——这一项去那台机器上看",
    historyTooBig: "这台机器上的历史太长，手机端暂时装不下——先在桌面上删掉几条旧会话",
    replayFailed: "全量重建失败，请重连",
    gapTooOld: "缺口太老，补不回来了",
    awayTooLong: "断开太久了，重新拉一份",
    unknownCommand: "这条命令的形状 Switchback 认不出来，没有执行",
  },
  {
    resultTooBig: "The result is too large to send remotely. Look at this one on the host machine",
    historyTooBig: "The history on the host machine is too long for the phone for now. Delete a few old threads on the desktop first",
    replayFailed: "Rebuilding the full history failed. Reconnect",
    gapTooOld: "The gap is too old to fill in",
    awayTooLong: "Disconnected for too long. Fetching a fresh copy",
    unknownCommand: "Switchback didn't recognize this command's shape, so it wasn't run",
  },
)
