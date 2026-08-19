import type { Event } from "@omni/protocol"

/**
 * 事件 ↔ JSONL 的编解码。**纯函数，不碰文件系统**——
 * 落盘格式的正确性能在没有磁盘的情况下被穷举测试。
 */

/**
 * 不落盘的事件类型。
 *
 * `item.delta` 是**冗余的**：每一条流式 item 最后都会有一条 `item.updated`
 * 带着完整内容（agentMessage 带全文，shell 带完整 aggregatedOutput）。
 * 回放时只认最终值，结果一模一样，而文件小一个数量级——
 * 一次 `pnpm build` 的输出增量能有几千条。
 *
 * `engine.status` 也不落：它描述的是**那一次进程**的状态，
 * 重启之后再放一遍「引擎已就绪」只会误导人。
 */
// `tasks.updated` 同理：它描述的是**此刻**谁在跑，落盘之后重放出来是一串早就跑完了
// 却还显示在跑的任务。一次长子 agent 还会写几十条进去，而它们一条都没有回放价值
const SKIP = new Set(["item.delta", "engine.status", "tasks.updated"])

export function shouldPersist(event: Event): boolean {
  return !SKIP.has(event.type)
}

export function encode(event: Event): string {
  return JSON.stringify(event)
}

/**
 * 解一行。**坏行返回 undefined 而不是抛**。
 *
 * 进程被 SIGKILL 掉时最后一行几乎必然是残缺的——那是正常现象，不是数据损坏。
 * 为一行截断的 JSON 丢掉整个会话的历史，是把小事故放大成大事故。
 */
export function decode(line: string): Event | undefined {
  const text = line.trim()
  if (text === "") return undefined
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== "object" || value === null) return undefined
    const event = value as Event
    return typeof event.type === "string" ? event : undefined
  } catch {
    return undefined
  }
}

export function decodeAll(text: string): readonly Event[] {
  const out: Event[] = []
  for (const line of text.split("\n")) {
    const event = decode(line)
    if (event !== undefined) out.push(event)
  }
  return out
}

/** 文件名只允许这些字符——id 是我们自己铸的，但落盘前仍然要挡一道。 */
const SAFE = /^[A-Za-z0-9._-]+$/

/**
 * 会话 id → 文件名。
 *
 * 不做拼接就用的话，一个含 `../` 的 id 能让写入跑到目录外面去。
 * id 由宿主铸造、目前不可能带斜杠，但**「目前不可能」不是安全依据**：
 * 这一步的成本是一次正则。
 */
export function fileNameOf(threadId: string): string | undefined {
  return SAFE.test(threadId) ? `${threadId}.jsonl` : undefined
}

export function threadIdOf(fileName: string): string | undefined {
  if (!fileName.endsWith(".jsonl")) return undefined
  const id = fileName.slice(0, -".jsonl".length)
  return SAFE.test(id) ? id : undefined
}
