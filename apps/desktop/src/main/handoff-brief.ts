import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Item, Thread } from "@switchback/protocol"
import type { Journal } from "@switchback/journal"
import { initial, itemsOf, reduceAll } from "@switchback/store"
import {
  briefOf,
  engineAt,
  logFacts,
  stintsOf,
  transcriptOf,
  turnEnginesOf,
  type BriefLog,
  type TurnEngines,
} from "@switchback/handoff"

/**
 * 换引擎自动交接的**磁盘那一半**：宿主判定「这是换家后的第一句」之后来要说明，
 * 这里读会话记录、把完整转写落盘、量一遍各段原始记录，交给 `briefOf` 拼成说明。
 *
 * ## 转写为什么写进工作区
 *
 * 每一家都能读自己的工作区，不需要额外的授权；应用数据目录在各家的沙箱与权限规则里
 * 待遇不一，有的要弹审批、有的干脆读不到。所以写 `<工作区>/.switchback/handoff/`，
 * 并在 `.switchback/` 里放一份内容为 `*` 的 `.gitignore`（和 `.pytest_cache` 一个做法）：
 * 不进版本库、`rg` 默认也不搜它，但按路径直接读照样读得到。工作区写不进去才退到应用数据目录。
 */

/** 大于这个的原始记录只报路径和体积：几百 MB 逐行 `JSON.parse` 会把这一句卡上好几秒。 */
const PARSE_LIMIT = 64 * 1024 * 1024
/** 拿去原始记录里定位字段的原生 id：最近这几个就够，搜不到的每个都是一遍全文检索。 */
const ID_PROBES = 8
const IGNORE = "# Switchback 的本地文件（换引擎交接转写），不进版本库\n*\n"

export interface HandoffBriefDeps {
  journal: Pick<Journal, "flush" | "read">
  /** 用户开着「换引擎自动交接」没有。函数：偏好随时会改。 */
  enabled: () => boolean
  label: (engine: string) => string
  /** 工作区写不进去时，转写退到这里。 */
  spareDir: string
  now: () => number
}

async function ensureIgnored(dir: string): Promise<void> {
  // `wx`：已经有了就不动——用户改过它的话，那是他的决定
  await writeFile(join(dir, ".gitignore"), IGNORE, { encoding: "utf8", flag: "wx" }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  })
}

async function writeInto(dir: string, name: string, text: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const path = join(dir, name)
  await writeFile(path, text, "utf8")
  return path
}

async function writeTranscript(thread: Thread, text: string, spareDir: string): Promise<string> {
  const name = `${thread.id}.md`
  try {
    const root = join(thread.cwd, ".switchback")
    await mkdir(root, { recursive: true })
    await ensureIgnored(root)
    return await writeInto(join(root, "handoff"), name, text)
  } catch {
    return writeInto(spareDir, name, text)
  }
}

/** 此前各段的原始记录，去重。正在续的那一条（当前这家、同一个句柄）不列：它自己记得。 */
function earlierLogs(thread: Thread): readonly { engine: string; path: string }[] {
  const seen = new Set<string>()
  const out: { engine: string; path: string }[] = []
  for (const segment of thread.segments ?? []) {
    const path = segment.logPath
    if (path === undefined || seen.has(path)) continue
    if (segment.engine === thread.engine && segment.handle === thread.engineHandle) continue
    seen.add(path)
    out.push({ engine: segment.engine, path })
  }
  return out
}

/** 这一家报过的工具调用原生 id，最近的在前：拿它们去原始记录里定位字段。 */
function probes(thread: Thread, items: readonly Item[], engines: TurnEngines, engine: string): readonly string[] {
  return items
    .filter((item) => item.kind === "tool_call")
    .filter((item) => (engines.get(item.turnId) ?? engineAt(thread, item.at)) === engine)
    .flatMap((item) => (item.nativeId === undefined ? [] : [item.nativeId]))
    .slice(-ID_PROBES)
    .reverse()
}

async function describeLog(
  log: { engine: string; path: string },
  ids: readonly string[],
  label: (engine: string) => string,
): Promise<BriefLog> {
  const base = { engine: label(log.engine), path: log.path }
  const bytes = await stat(log.path).then((info) => info.size, () => undefined)
  if (bytes === undefined) return { ...base, bytes, facts: "unreadable" }
  if (bytes > PARSE_LIMIT) return { ...base, bytes, facts: "large" }
  const content = await readFile(log.path, "utf8").catch(() => undefined)
  return { ...base, bytes, facts: content === undefined ? "unreadable" : logFacts(content, ids) }
}

export function createHandoffBrief(deps: HandoffBriefDeps): (thread: Thread) => Promise<string | undefined> {
  return async (thread) => {
    if (!deps.enabled()) return undefined
    // 宿主发事件不等落盘：先把在途的写完，读到的才是到这一刻为止的完整记录
    await deps.journal.flush()
    const events = await deps.journal.read(thread.id)
    const items = itemsOf(reduceAll(initial(), events), thread.id)
    if (items.length === 0) return undefined
    const engines = turnEnginesOf(events)
    const transcript = transcriptOf({ thread, items, label: deps.label, at: deps.now(), engines })
    const path = await writeTranscript(thread, transcript.text, deps.spareDir)
    const logs = await Promise.all(
      earlierLogs(thread).map((log) => describeLog(log, probes(thread, items, engines, log.engine), deps.label)),
    )
    return briefOf({
      engine: deps.label(thread.engine),
      stints: stintsOf(thread, items, engines).map((stint) => ({ ...stint, engine: deps.label(stint.engine) })),
      transcript: {
        path,
        lines: transcript.lines,
        bytes: Buffer.byteLength(transcript.text),
        ...(transcript.lastTurn === undefined ? {} : { lastTurn: transcript.lastTurn }),
      },
      logs,
    })
  }
}
