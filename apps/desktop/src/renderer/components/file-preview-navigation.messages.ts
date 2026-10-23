import { defineMessages } from "@switchback/i18n"

/** 文件预览顶上的返回、后退、前进。 */
export const PREVIEW_NAV = defineMessages(
  {
    none: (verb: string) => `没有可${verb}的文件`,
    to: (verb: string, name: string, key: string) => `${verb}到 ${name}（${key}）`,
    back: "后退",
    forward: "前进",
    label: "文件阅读导航",
    index: "返回文件列表",
    files: "文件",
    backLabel: "后退到上一个文件",
    forwardLabel: "前进到下一个文件",
  },
  {
    none: (verb) => `No file to go ${verb.toLowerCase()} to`,
    to: (verb, name, key) => `${verb} to ${name} (${key})`,
    back: "Back",
    forward: "Forward",
    label: "File navigation",
    index: "Back to the file list",
    files: "Files",
    backLabel: "Back to the previous file",
    forwardLabel: "Forward to the next file",
  },
)
