import { execFile } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { promisify } from "node:util"
import { app, dialog } from "electron"
import type { Logger } from "./log.js"

const run = promisify(execFile)

/** 日志尾部取多少行进诊断包。够看出「崩之前发生了什么」，又不至于变成一整份日志。 */
const TAIL_LINES = 400

/**
 * 引擎在这台机器上是什么状态。
 *
 * **「装了没」是支持渠道的第一个问题**，而它有三种不同的答案：
 * 不在 PATH 上、在但版本不对、在且能跑。分开报，别都归成「引擎有问题」。
 */
async function probeEngine(command: string): Promise<string> {
  const found = await run("which", [command]).catch(() => undefined)
  if (found === undefined) return `${command}: 不在 PATH 上`
  const version = await run(command, ["--version"]).catch((error: unknown) => ({
    stdout: `（--version 失败：${error instanceof Error ? error.message : String(error)}）`,
  }))
  return `${command}: ${found.stdout.trim()} — ${version.stdout.trim()}`
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
export async function buildReport(logger: Logger): Promise<string> {
  const engines = await Promise.all([probeEngine("codex"), probeEngine("claude")])
  return [
    "# omni 诊断报告",
    "",
    "> **不含会话内容**：没有提示词、没有模型回复、没有文件内容、没有命令输出。",
    ">",
    "> 下方日志里含引擎自己打的错误输出，可能带路径或命令片段。",
    "> 像凭据的部分已按模式抹去，但那份模式清单不可能完备——**发出去之前扫一眼**。",
    "",
    "## 版本",
    `- omni ${app.getVersion()}`,
    `- Electron ${process.versions.electron} / Chromium ${process.versions.chrome} / Node ${process.versions.node}`,
    `- ${process.platform} ${process.arch} ${process.getSystemVersion()}`,
    `- 已打包：${app.isPackaged ? "是" : "否（开发模式）"}`,
    "",
    "## 引擎",
    ...engines.map((e) => `- ${e}`),
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
export async function exportReport(logger: Logger): Promise<void> {
  const report = await buildReport(logger)
  const target = await dialog.showSaveDialog({
    title: "导出诊断报告",
    defaultPath: `omni-诊断-${new Date().toISOString().slice(0, 10)}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  })
  if (target.canceled || target.filePath === undefined) return
  await writeFile(target.filePath, report, "utf8")
}
