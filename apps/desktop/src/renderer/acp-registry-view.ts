import type { AcpEngineRow, LaunchPlan, RegistryRow, RegistryView } from "../shared/acp-registry.js"
import { BUILTIN_ENGINE_LABELS, type BuiltinEngineId } from "../shared/builtin-engines.js"

/**
 * 「安装与接入」页 ACP 那几块的纯计算：筛选、说多旧、说多大、把要执行的东西写成一行字。
 *
 * **要执行的那一行必须是真的那一行**：界面上摆出来的命令就是主进程会 spawn 的命令，
 * 一个字都不美化——人照着它复制去终端跑，结果应当一模一样。
 */

/** 按名字、id、描述、作者筛，不分大小写；空白分开的每个词都要命中。 */
export function filterRows(rows: readonly RegistryRow[], query: string): readonly RegistryRow[] {
  const words = query.toLowerCase().split(/\s+/u).filter((word) => word !== "")
  if (words.length === 0) return rows
  return rows.filter((row) => {
    const hay = [row.name, row.id, row.description ?? "", ...row.authors].join(" ").toLowerCase()
    return words.every((word) => hay.includes(word))
  })
}

/** 「12 分钟前」这类说法。离线时人要知道手上这份清单有多旧。 */
export function ageOf(at: number | undefined, now: number): string {
  if (at === undefined) return "还没取到过"
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 1) return "刚刚取的"
  if (minutes < 60) return `${String(minutes)} 分钟前取的`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${String(hours)} 小时前取的` : `${String(Math.floor(hours / 24))} 天前取的`
}

export function sizeOf(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 一个参数要不要加引号：和终端里看到的一样，带空白或引号的才加。 */
function quoted(arg: string): string {
  return /^[\w@%+=:,./-]+$/u.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`
}

export function commandLine(command: string, args: readonly string[]): string {
  return [command, ...args].map(quoted).join(" ")
}

/** 「接入」前摆出来的那两句：要做什么、做之前你该知道什么。 */
export function planText(plan: LaunchPlan): { what: string; note: string } {
  if (plan.kind === "binary") {
    const run = commandLine(plan.cmd, plan.args)
    return {
      what: `下载 ${plan.archive}`,
      note: `${plan.sha256 === undefined ? "注册表没给校验值" : `按注册表的 sha256 校验`}，解到 omni 数据目录的 agents/ 下，之后以 ${run} 启动。`,
    }
  }
  return {
    what: `运行 ${commandLine(plan.command, plan.args)}`,
    note: `第一次运行时 ${plan.kind} 会下载 ${plan.package}（走你自己的 ${plan.kind === "npx" ? "npm" : "uv"} 配置），之后用本机缓存。`,
  }
}

/** 一家已接的引擎在注册表里有没有新版：有就给新版本号。 */
export function updateOf(engine: AcpEngineRow, view: RegistryView | undefined): string | undefined {
  if (engine.source === undefined) return undefined
  const row = view?.rows.find((one) => one.id === engine.source?.id)
  return row?.connected?.name === engine.name && row.connected.update ? row.version : undefined
}

/**
 * 注册表里那几家 omni 已经内置了原生入口的（各家官方的 ACP 适配器）。
 *
 * 接它们不是错，但会在引擎下拉里另占一项，而且走的是通用 ACP 驱动——
 * 界面上得先说一声，不然人会以为这是 omni 缺的那一家。**只做标注，不拦**：
 * 这张表过期了（注册表改了 id）的代价只是少一个提示。
 */
const TWINS: Readonly<Record<string, BuiltinEngineId>> = {
  "claude-acp": "claude",
  "codex-acp": "codex",
  "grok-build": "grok",
  kimi: "kimi",
}

export function builtinTwin(id: string): string | undefined {
  // 只认自己的键：注册表 id 是外来字符串，`__proto__` 这类会顺着原型链摸到别的东西
  return Object.hasOwn(TWINS, id) ? BUILTIN_ENGINE_LABELS[TWINS[id] as BuiltinEngineId] : undefined
}
