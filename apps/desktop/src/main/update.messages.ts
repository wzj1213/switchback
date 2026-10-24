import { defineMessages } from "@switchback/i18n"

/** 「检查更新」的几个对话框。版本说明是发布者写的，不翻译。 */
export const UPDATE = defineMessages(
  {
    newer: (version: string) => `有新版本 ${version}`,
    manualOnly: "Switchback 目前只提示、不自动安装：自动安装需要应用带 Apple 开发者签名，这个包还没有。",
    download: "去下载",
    later: "以后再说",
    failed: "检查更新失败",
    garbled: "更新源返回的内容看不懂（要 version 和 https 的 url）",
    ok: "知道了",
    current: "已经是最新版本。",
    fine: "好",
  },
  {
    newer: (version) => `Version ${version} is available`,
    manualOnly: "Switchback only tells you about updates; it doesn't install them. Installing automatically needs an Apple Developer signature, which this build doesn't have yet.",
    download: "Download",
    later: "Not Now",
    failed: "Couldn't check for updates",
    garbled: "The update feed returned something unreadable (it needs a version and an https url).",
    ok: "OK",
    current: "You're on the latest version.",
    fine: "OK",
  },
)
