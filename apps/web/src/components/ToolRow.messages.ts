import { count, defineMessages } from "@switchback/i18n"

/** 工具行的折叠标题与展开后的分区标题。命令、路径、网址原样显示。 */
export const TOOL_ROW = defineMessages(
  {
    waiting: (command: string) => `等后台终端 · ${command}`,
    edit: (path: string, files: number) => `改 ${path}${files > 1 ? ` 等 ${String(files)} 个文件` : ""}`,
    read: (path: string) => `读 ${path}`,
    fetch: (url: string) => `取 ${url}`,
    output: "终端输出：",
    input: (n: number) => `后台终端输入 ${String(n)}：`,
  },
  {
    waiting: (command) => `Waiting for background terminal · ${command}`,
    edit: (path, files) => `Edit ${path}${files > 1 ? ` and ${count(files - 1, "more file")}` : ""}`,
    read: (path) => `Read ${path}`,
    fetch: (url) => `Fetch ${url}`,
    output: "Terminal output:",
    input: (n) => `Background terminal input ${String(n)}:`,
  },
)
