import { readFile, writeFile } from "node:fs/promises"
import { app, dialog } from "electron"
import { probeCommand } from "@switchback/engine"
import type { Logger } from "./log.js"
import { dumpDir, type CrashInfo } from "./crash.js"
import type { Locale } from "@switchback/i18n"
import { DIAGNOSE } from "./diagnose.messages.js"

type Text = (typeof DIAGNOSE)[Locale]

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

async function tail(file: string, m: Text): Promise<string> {
  const text = await readFile(file, "utf8").catch(() => "")
  if (text === "") return m.noLog
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
function crashSection(crash: CrashInfo, m: Text): readonly string[] {
  if (!crash.uncleanExit && crash.dumps.length === 0) return [m.noCrash]
  const lines = crash.uncleanExit ? [m.unclean] : []
  if (crash.dumps.length === 0) return [...lines, m.noDumps]
  return [
    ...lines,
    m.dumpDir(dumpDir()),
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
function systemVersion(m: Text): string {
  const fn = (process as NodeJS.Process & { getSystemVersion?: () => string }).getSystemVersion
  return typeof fn === "function" ? fn.call(process) : m.noSystem
}

export async function buildReport(logger: Logger, crash: CrashInfo, locale: Locale): Promise<string> {
  const m = DIAGNOSE[locale]
  const engines = await Promise.all([probeEngine("codex"), probeEngine("claude")])
  return [
    m.title,
    "",
    m.privacy,
    "",
    m.versions,
    `- Switchback ${app.getVersion()}`,
    `- Electron ${process.versions.electron} / Chromium ${process.versions.chrome} / Node ${process.versions.node}`,
    `- ${process.platform} ${process.arch} ${systemVersion(m)}`,
    m.packaged(app.isPackaged),
    "",
    m.engines,
    ...engines.map((e) => `- ${e}`),
    "",
    m.crashes,
    ...crashSection(crash, m),
    "",
    m.dataDir,
    `- ${app.getPath("userData")}`,
    "",
    m.logTail(TAIL_LINES),
    "```",
    await tail(logger.file, m),
    "```",
    "",
  ].join("\n")
}

/** 让用户选个地方存下来。取消就什么都不做。 */
export async function exportReport(logger: Logger, crash: CrashInfo, locale: Locale): Promise<void> {
  const report = await buildReport(logger, crash, locale)
  const target = await dialog.showSaveDialog({
    title: DIAGNOSE[locale].save,
    defaultPath: DIAGNOSE[locale].file(new Date().toISOString().slice(0, 10)),
    filters: [{ name: "Markdown", extensions: ["md"] }],
  })
  if (target.canceled || target.filePath === undefined) return
  await writeFile(target.filePath, report, "utf8")
}
