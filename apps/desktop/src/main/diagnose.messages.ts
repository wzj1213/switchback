import { defineMessages } from "@switchback/i18n"

/**
 * 诊断报告与它的保存框。报告是给人发出去的，所以跟着界面语言；
 * 里面的日志尾部是原样贴的，不翻译。
 */
export const DIAGNOSE = defineMessages(
  {
    noLog: "（没有日志）",
    noCrash: "- 没有崩溃记录。",
    unclean: "- **上次不是正常退出的。**",
    noDumps: "- 没有崩溃转储文件。",
    dumpDir: (dir: string) => `- 转储目录：\`${dir}\`（**内容不在本报告里**，里面可能有内存快照）`,
    noSystem: "（取不到系统版本）",
    title: "# Switchback 诊断报告",
    privacy: [
      "> **不含会话内容**：没有提示词、没有模型回复、没有文件内容、没有命令输出。",
      ">",
      "> 下方日志里含引擎自己打的错误输出，可能带路径或命令片段。",
      "> 像凭据的部分已按模式抹去，但那份模式清单不可能完备——**发出去之前扫一眼**。",
    ].join("\n"),
    versions: "## 版本",
    packaged: (yes: boolean) => `- 已打包：${yes ? "是" : "否（开发模式）"}`,
    engines: "## 引擎",
    crashes: "## 崩溃",
    dataDir: "## 数据目录",
    logTail: (lines: number) => `## 日志尾部（最后 ${String(lines)} 行）`,
    save: "导出诊断报告",
    file: (day: string) => `Switchback-诊断-${day}.md`,
  },
  {
    noLog: "(no log)",
    noCrash: "- No crash records.",
    unclean: "- **The last exit wasn't clean.**",
    noDumps: "- No crash dump files.",
    dumpDir: (dir) => `- Dump folder: \`${dir}\` (**its contents aren't in this report**; they may include memory snapshots)`,
    noSystem: "(system version unavailable)",
    title: "# Switchback diagnostic report",
    privacy: [
      "> **No conversation content**: no prompts, no model replies, no file contents, no command output.",
      ">",
      "> The log below includes the engines' own error output, which may contain paths or bits of commands.",
      "> Anything that looks like a credential is masked by pattern, but that pattern list can't be complete. **Skim it before you send it.**",
    ].join("\n"),
    versions: "## Versions",
    packaged: (yes) => `- Packaged: ${yes ? "yes" : "no (development mode)"}`,
    engines: "## Engines",
    crashes: "## Crashes",
    dataDir: "## Data folder",
    logTail: (lines) => `## Log tail (last ${String(lines)} lines)`,
    save: "Export Diagnostic Report",
    file: (day) => `Switchback-diagnostics-${day}.md`,
  },
)
