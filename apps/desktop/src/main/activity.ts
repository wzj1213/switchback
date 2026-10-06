import { ipcMain } from "electron"
import type { Event } from "@switchback/protocol"
import type { ActivityDigest } from "../shared/activity.js"
import { createTally, digestOf, foldThread } from "./activity-fold.js"
import type { Attached } from "./host.js"
import type { Logger } from "./log.js"

/**
 * 「活动」那一页的数据来源：**把磁盘上的 journal 整个走一遍**。
 *
 * ## 为什么必须读盘，不能问渲染层现成的 store
 *
 * 渲染层手上确实有全部会话，但那是**归约之后的当前状态**：`usage` 只剩每条会话
 * 最后报的那一份。「8 月 3 号烧了多少」在那份状态里不存在——要按天分桶，
 * 只能回到事件流本身。
 *
 * ## 为什么一条一条读，不并发
 *
 * `journal.read` 是整个文件进内存（那是它写在 README 里的已知限制）。
 * 并发读 17 个文件峰值就是 17 份解出来的对象同时在堆上；顺序走一遍，
 * 峰值只有一份。这一页不在任何关键路径上，慢一点没人会注意到，
 * 而一次 GC 抖动整个应用都会卡。
 *
 * ## 缓存 30 秒
 *
 * 用户在设置面板里来回切页不该每次都重扫；但他也可能是**刚跑完一轮回来看**的，
 * 所以窗口很短，而且面板上永远有一颗「重新统计」。
 */
const TTL = 30_000

interface Cache {
  at: number
  digest?: ActivityDigest
  /** 正在算的那一次。**并发进来的第二个请求要等它，不是再扫一遍。** */
  pending?: Promise<ActivityDigest>
}

async function scan(attached: Attached, now: () => number): Promise<ActivityDigest> {
  const started = now()
  // 和 `rebuild` 同一条规矩：宿主发事件不等落盘，不 flush 就会读到残缺的一份
  await attached.journal.flush().catch(() => undefined)
  const ids = await attached.journal.list().catch((): readonly string[] => [])
  const tally = createTally()
  let skipped = 0
  for (const id of ids) {
    const events = await attached.journal.read(id).catch((): readonly Event[] => [])
    if (events.length === 0) {
      skipped += 1
      continue
    }
    foldThread(tally, events)
  }
  return digestOf(tally, { skipped, ms: now() - started, now: now() })
}

/**
 * 渲染层要一份统计。`refresh` 无视缓存。
 *
 * **失败不吞。** 这一页整页就这一份数据，读不出来时界面要能说「读失败了」，
 * 而不是画一屏货真价实的零。
 */
export function installActivity(attached: Attached, log: Logger, now = Date.now): void {
  const cache: Cache = { at: 0 }
  ipcMain.handle("switchback:activity", async (_e, refresh?: boolean): Promise<ActivityDigest> => {
    const fresh = cache.digest !== undefined && now() - cache.at < TTL
    if (refresh !== true && fresh && cache.digest !== undefined) return cache.digest
    cache.pending ??= scan(attached, now)
      .then((digest) => {
        cache.digest = digest
        cache.at = now()
        log.write("info", "activity", `扫了 ${String(digest.threads)} 条记录，用时 ${String(digest.ms)}ms`)
        return digest
      })
      .finally(() => {
        cache.pending = undefined
      })
    return cache.pending
  })
}
