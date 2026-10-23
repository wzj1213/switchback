import { defineMessages } from "@switchback/i18n"

/** 文件预览读不出来时的说法。 */
export const PREVIEW_VIEW = defineMessages(
  { noBridge: "桌面桥没有接通，暂时不能读取文件。", failed: "读取这份文件失败，请稍后重试。", reading: "正在读取…" },
  { noBridge: "The desktop bridge isn't connected, so files can't be read right now.", failed: "Couldn't read this file. Try again later.", reading: "Reading…" },
)
