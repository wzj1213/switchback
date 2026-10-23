import { defineMessages } from "@switchback/i18n"

/** 审核面板里当前文件那一行。 */
export const REVIEW_FILE_HEAD = defineMessages(
  {
    copyWait: "文件改动读取完成后才能复制",
    copy: "复制这份文件改动",
    copied: "文件改动已复制",
    preview: "预览当前文件",
    reveal: "在访达中显示",
    unstageTip: "把这个文件从暂存区拿出来（工作区里的改动不动）",
    unstage: "取消暂存",
    stageTip: "把这个文件现在的改动放进暂存区，之后「提交已暂存」只提交暂存的那些",
    stage: "暂存",
  },
  {
    copyWait: "You can copy once the file changes finish loading",
    copy: "Copy this file's changes",
    copied: "File changes copied",
    preview: "Preview current file",
    reveal: "Show in Finder",
    unstageTip: "Take this file out of the staging area (the changes in the workspace stay)",
    unstage: "Unstage",
    stageTip: "Stage this file's current changes. “Commit staged” then commits only what's staged.",
    stage: "Stage",
  },
)
