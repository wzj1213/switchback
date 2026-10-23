import { defineMessages } from "@switchback/i18n"

/** 远程窗口里那些只能在宿主机上做的事，点了之后说的那一句。 */
export const REMOTE_LOCAL = defineMessages(
  {
    onlyThere: "这一项只能在那台机器上做",
    copied: (what: string, path: string) => `${what}在那台机器上：${path}（路径已复制）`,
    located: (what: string, path: string) => `${what}在那台机器上：${path}`,
    config: "这份配置",
    doc: "项目说明",
    file: "这个文件",
    engines: "引擎注册表（engines.json）在那台机器的数据目录里，去那台上打开",
    diagnose: "诊断报告要在那台机器上导出：菜单「帮助 → 导出诊断报告」",
    remoteWindow: "远程窗口",
    folder: (host: string) => `在 ${host} 上的目录（完整路径）：`,
  },
  {
    onlyThere: "This can only be done on the host machine",
    copied: (what, path) => `${what} is on the host machine: ${path} (path copied)`,
    located: (what, path) => `${what} is on the host machine: ${path}`,
    config: "This config file",
    doc: "The project instructions",
    file: "This file",
    engines: "The engine registry (engines.json) is in the host machine's data folder; open it there",
    diagnose: "Export the diagnostic report on the host machine: Help → Export Diagnostic Report",
    remoteWindow: "remote window",
    folder: (host) => `Folder on ${host} (full path):`,
  },
)
