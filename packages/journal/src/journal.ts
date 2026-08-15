import { appendFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import type { Event, ThreadId } from "@omni/protocol"
import { decodeAll, encode, fileNameOf, shouldPersist, threadIdOf } from "./codec.js"

export interface JournalConfig {
  /** 落盘根目录。宿主传绝对路径——本包不读环境变量、不猜 home。 */
  dir: string
  /** 每个会话的文件上限；超过就停止追加。默认 32 MB。 */
  maxBytes?: number
}

export interface Journal {
  /** 追加一条。**不抛**——落盘失败不该掐断正在进行的会话。 */
  append: (threadId: ThreadId, event: Event) => Promise<void>
  /**
   * 等所有在途写入落盘。
   *
   * **回放之前必须调一次。** 宿主发事件时是 `void journal.append(...)`（不等），
   * 所以「事件已经发出去了」和「事件已经在文件里了」之间有一个窗口。
   * 在这个窗口里读 journal，读到的是残缺的一份——而回放会按
   * 「`resumeAt` 之前的增量都已经在全量里」把那些事件全丢掉。
   * 结果就是：会话还在，里面的消息全没了。这个 bug 实测复现过。
   */
  flush: () => Promise<void>
  /** 读回一个会话的全部事件，按写入顺序。 */
  read: (threadId: ThreadId) => Promise<readonly Event[]>
  /** 列出磁盘上有记录的会话，**最近写过的在前**。 */
  list: () => Promise<readonly ThreadId[]>
  /** 删掉一个会话的记录。不存在也不报错——删除是幂等的。 */
  remove: (threadId: ThreadId) => Promise<void>
}

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024

/**
 * 追加式事件日志，一个会话一个 JSONL 文件。
 *
 * 为什么是追加而不是「存一份状态快照」：事件流本来就是真源，
 * 而 `@omni/store` 的归约器是纯函数——回放一遍就能得到当时的界面状态，
 * 不需要第二套序列化逻辑，也就不会出现「快照和事件对不上」这类问题。
 *
 * **写入失败一律吞掉并继续。** 磁盘满了、目录被删了，都不该让一个正在跑的
 * 会话中断——用户宁可丢历史也不愿丢正在进行的工作。这是有意的取舍。
 */
/**
 * 写一行。
 *
 * 超限就停笔——轮转策略以后再说，但**无声地把磁盘写满**是不能接受的。
 * 提到外面是因为 `createJournal` 撑破了行数闸门，而这一段本来就不依赖闭包里的东西。
 */
async function writeOne(file: string, line: string, ready: Promise<boolean>, maxBytes: number): Promise<void> {
  if (!(await ready)) return
  const size = await stat(file).then(
    (info) => info.size,
    () => 0,
  )
  if (size >= maxBytes) return
  await appendFile(file, `${line}\n`, "utf8")
}

export function createJournal(config: JournalConfig): Journal {
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES
  const ready = mkdir(config.dir, { recursive: true }).then(
    () => true,
    () => false,
  )
  /** 每个会话串行写，避免同一文件的并发 append 交错出半行。 */
  const chains = new Map<ThreadId, Promise<void>>()

  const pathOf = (threadId: ThreadId): string | undefined => {
    const name = fileNameOf(threadId)
    return name === undefined ? undefined : join(config.dir, name)
  }

  const append = async (threadId: ThreadId, event: Event): Promise<void> => {
    if (!shouldPersist(event)) return
    const file = pathOf(threadId)
    if (file === undefined) return
    const prev = chains.get(threadId) ?? Promise.resolve()
    const next = prev.then(() => writeOne(file, encode(event), ready, maxBytes)).catch(() => undefined)
    chains.set(threadId, next)
    return next
  }

  const read = async (threadId: ThreadId): Promise<readonly Event[]> => {
    const file = pathOf(threadId)
    if (file === undefined) return []
    const text = await readFile(file, "utf8").catch(() => "")
    return decodeAll(text)
  }

  const list = async (): Promise<readonly ThreadId[]> => {
    const names = await readdir(config.dir).catch((): string[] => [])
    const found = names
      .map((name) => ({ id: threadIdOf(name), name }))
      .filter((e): e is { id: string; name: string } => e.id !== undefined)
    const stamped = await Promise.all(
      found.map(async (entry) => ({
        id: entry.id,
        at: await stat(join(config.dir, entry.name)).then(
          (info) => info.mtimeMs,
          () => 0,
        ),
      })),
    )
    // 最近写过的在前：重启后侧栏的顺序和关掉之前一致
    return stamped.sort((a, b) => b.at - a.at).map((entry) => entry.id)
  }

  const remove = async (threadId: ThreadId): Promise<void> => {
    const file = pathOf(threadId)
    if (file === undefined) return
    // 先把这个会话的写入链摘掉，免得删完之后还有一条在途的 append 把文件又建回来
    chains.delete(threadId)
    await rm(file, { force: true }).catch(() => undefined)
  }

  return {
    append,
    read,
    list,
    remove,
    // 取一次快照再等：等待期间新来的写入不该把这次 flush 无限拖下去
    flush: async () => {
      await Promise.all([...chains.values()])
    },
  }
}
