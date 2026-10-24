import { defineMessages } from "@switchback/i18n"

/** 文件预览面板「看不了」时显示的那一句。 */
export const PREVIEW = defineMessages(
  {
    unread: "这个文件在工作区外，而且这条会话没读过它。",
    symlink: "这个路径通过符号链接离开了当前工作区。",
    missing: "文件已经不存在，或者暂时无法读取。",
    noPath: "没有可预览的文件路径。",
    foreign: "这条会话没有使用这个工作区，不能预览其中的文件。",
    directory: "这是一个目录，不能作为文件预览。",
    binary: "这是二进制文件，不能按文本预览。",
    failed: "读取这份文件失败，请稍后重试。",
  },
  {
    unread: "This file is outside the workspace, and this thread hasn't read it.",
    symlink: "This path leaves the current workspace through a symbolic link.",
    missing: "The file no longer exists, or can't be read right now.",
    noPath: "There's no file path to preview.",
    foreign: "This thread doesn't use this workspace, so its files can't be previewed.",
    directory: "This is a folder, so it can't be previewed as a file.",
    binary: "This is a binary file, so it can't be previewed as text.",
    failed: "Couldn't read this file. Try again in a moment.",
  },
)
