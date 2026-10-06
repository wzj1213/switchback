import { readFile, writeFile } from "node:fs/promises"
import { app, dialog } from "electron"
import { probeCommand } from "@switchback/engine"
import type { Logger } from "./log.js"
import { dumpDir, type CrashInfo } from "./crash.js"

/** 日志尾部取多少行进诊断包。够看出「崩之前发生了什么」，又不至于变成一整份日志。 */
const TAIL_LINES = 400

/**
 * 引擎在这台机器上是什么状态。
 *
 * **「装了没」是支持渠道的第一个问题**，而它有三种不同的答案：
 * 不在 PATH 上、在但跑不起来、在且能跑。分开报，别都归成「引擎有问题」。
 *
 * 直接用 `@switchback/engine` 的 `probeCommand`，不在这里再写一份：
 * 原来这里自己 `which` 了一遍，于是「Windows 上没有 which」这个 bug
 * 得修两处——而第二处一定会被漏掉。
 */
async function probeEngine(command: string): Promise<string> {
  const probe = await probeCommand(command)
  return `${command}: ${probe.state} — ${probe.detail}`
}

async function tail(file: string): Promise<string> {
  const text = await readFile(file, "utf8").catch(() => "")
  if (text === "") return "（没有日志）"
  return text.split("\n").slice(-TAIL_LINES).join("\n")
}

/**
 * 生成一份可以发给别人的诊断报告。
 *
 * **不含会话内容**：没有提示词、没有模型回复、没有文件内容、没有命令输出。
 * 会话记录（`threads/*.jsonl`）一个字都不进这份报告。
 *
 * **但也不能说「绝对没有敏感信息」**：日志里有引擎的 stderr，那是不受我们控制
 * 的文本，可能带路径、命令片段，`log.ts` 只能按模式抹掉像凭据的部分——
 * 那份清单不可能完备。所以报告头上照实写「发出去之前扫一眼」。
 *
 * 说满了比说少了危险：用户会因为一句「绝对安全」而不看就外发。
 */
/**
 * 崩溃那一段。
 *
 * **只报文件名和时间，不报内容。** 转储里可能有内存快照，而内存里装着
 * 用户的代码、提示词和路径——这份报告是要发给别人的。
 * 附上目录路径，真要深挖的人自己去拿。
 */
function crashSection(crash: CrashInfo): readonly string[] {
  if (!crash.uncleanExit && crash.dumps.length === 0) return ["- 没有崩溃记录。"]
  const lines = crash.uncleanExit ? ["- **上次不是正常退出的。**"] : []
  if (crash.dumps.length === 0) return [...lines, "- 没有崩溃转储文件。"]
  return [
    ...lines,
    `- 转储目录：\`${dumpDir()}\`（**内容不在本报告里**，里面可能有内存快照）`,
    ...crash.dumps
      .slice(0, 5)
      .map((d) => `- ${d.name} — ${new Date(d.at).toISOString()}`),
  ]
}

/**
 * 系统版本。**取不到就空着，不能因此整份报告生成不出来**——
 * 诊断报告最该好使的时刻恰恰是「什么都不太对劲」的时候，
 * 为一个可有可无的字段抛异常是本末倒置。（`getSystemVersion` 是 Electron 才有的。）
 */
function systemVersion(): string {
  const fn = (process as NodeJS.Process & { getSystemVersion?: () => string }).getSystemVersion
  return typeof fn === "function" ? fn.call(process) : "（取不到系统版本）"
}

export async function buildReport(logger: Logger, crash: CrashInfo): Promise<string> {
  const engines = await Promise.all([probeEngine("codex"), probeEngine("claude")])
  return [
    "# Switchback 诊断报告",
    "",
    "> **不含会话内容**：没有提示词、没有模型回复、没有文件内容、没有命令输出。",
    ">",
    "> 下方日志里含引擎自己打的错误输出，可能带路径或命令片段。",
    "> 像凭据的部分已按模式抹去，但那份模式清单不可能完备——**发出去之前扫一眼**。",
    "",
    "## 版本",
    `- Switchback ${app.getVersion()}`,
    `- Electron ${process.versions.electron} / Chromium ${process.versions.chrome} / Node ${process.versions.node}`,
    `- ${process.platform} ${process.arch} ${systemVersion()}`,
    `- 已打包：${app.isPackaged ? "是" : "否（开发模式）"}`,
    "",
    "## 引擎",
    ...engines.map((e) => `- ${e}`),
    "",
    "## 崩溃",
    ...crashSection(crash),
    "",
    "## 数据目录",
    `- ${app.getPath("userData")}`,
    "",
    `## 日志尾部（最后 ${String(TAIL_LINES)} 行）`,
    "```",
    await tail(logger.file),
    "```",
    "",
  ].join("\n")
}

/** 让用户选个地方存下来。取消就什么都不做。 */
export async function exportReport(logger: Logger, crash: CrashInfo): Promise<void> {
  const report = await buildReport(logger, crash)
  const target = await dialog.showSaveDialog({
    title: "导出诊断报告",
    defaultPath: `Switchback-诊断-${new Date().toISOString().slice(0, 10)}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  })
  if (target.canceled || target.filePath === undefined) return
  await writeFile(target.filePath, report, "utf8")
}
