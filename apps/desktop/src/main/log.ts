import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs"
import { join } from "node:path"

export type Level = "info" | "warn" | "error"

export interface Logger {
  write: (level: Level, scope: string, message: string) => void
  /** 日志文件的绝对路径，导出诊断包时要用。 */
  file: string
}

/** 单个文件上限，超了就轮转一次。只留两代——再多也没人看。 */
const MAX_BYTES = 2 * 1024 * 1024

/**
 * 一条日志最多这么长。
 *
 * 引擎的 stderr 可能一次吐几百 KB；不截的话一次崩溃就把整个日志冲掉，
 * 而真正有用的往往是**前几行**。
 */
const MAX_LINE = 2000

const TRUNCATED = "〔已截断〕"
const MASK = "〔已抹去〕"

/**
 * 看起来像凭据的东西。
 *
 * **调用方只往日志里塞结构性事实**（事件类型、引擎名、错误消息），但有一处
 * 塞的是引擎的 stderr——那是不受我们控制的文本，里面完全可能有 token。
 *
 * 这份清单**不可能完备**，所以它是「减少泄漏」而不是「保证没有」：
 * 诊断报告的开头也照实这么写。不写清楚的话，用户会以为它绝对安全而直接外发。
 */
const SECRETS: readonly RegExp[] = [
  // 各家常见的前缀式 token：sk-…、ghp_…、xoxb-…、AKIA…
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  // Authorization 头
  /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{16,}=*/g,
  // 形如 key=值 / token: 值 的赋值
  /\b(?:api[_-]?key|secret|token|password|passwd)\s*[=:]\s*\S+/gi,
  // 裸的长不透明串（JWT、base64 密钥）
  /\b[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g,
]

/**
 * 压成一行、抹掉像凭据的片段、超长截断。
 *
 * **抹在截断之前**：只截断的话，出现在长文本开头的密钥会原封不动地活下来——
 * 这是写测试时才发现的，第一版就是这么漏的。
 */
export function scrub(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim()
  const masked = SECRETS.reduce((text, pattern) => text.replace(pattern, MASK), oneLine)
  if (masked.length > MAX_LINE) return `${masked.slice(0, MAX_LINE)} …${TRUNCATED}`
  return masked
}

function rotate(file: string): void {
  try {
    if (statSync(file).size < MAX_BYTES) return
    renameSync(file, `${file}.1`)
  } catch {
    // 文件还不存在，或者轮转失败——都不该影响正在跑的会话
  }
}

/**
 * 落盘日志。
 *
 * **同步写**，与 journal 的异步追加相反。理由：日志最有价值的时刻是进程即将
 * 崩溃的那一瞬间，异步写的那条大概率还没落地就没了。日志量比事件流小几个数量级，
 * 同步的代价可以接受。
 */
export function createLogger(dir: string): Logger {
  const file = join(dir, "switchback.log")
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // 建不出来就退化成只往 stderr 写，不能因此起不来
  }
  return {
    file,
    write: (level, scope, message) => {
      const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${scrub(message)}\n`
      // 开发时终端还是要看得到
      process.stderr.write(line)
      try {
        rotate(file)
        appendFileSync(file, line, "utf8")
      } catch {
        // 磁盘满、权限不足——记不下来也不能掐掉应用
      }
    },
  }
}
