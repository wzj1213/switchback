import { join } from "node:path"
import type { HostDeps } from "@switchback/host"
import type { Journal } from "@switchback/journal"
import type { Logger } from "./log.js"
import type { WorktreeBaselines } from "./worktree-baseline.js"
import { createHandoffBrief } from "./handoff-brief.js"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"

/**
 * `HostDeps` 里那几项**可选的外部 IO** 在桌面端怎么接。
 *
 * 共同点是：宿主只管什么时候调，做不成也不能拦住会话——所以这里每一项都把失败
 * 收成一条日志，而不是抛回宿主。从 `host.ts` 拆出来是行数闸门逼的，边界也在这儿：
 * 那边管「宿主怎么建、窗口怎么接」，这边管「宿主借出去的那几件事失败了怎么办」。
 */
export function baselineDeps(
  log: Logger,
  baselines: WorktreeBaselines | undefined,
): Pick<HostDeps, "ensureWorktreeBaseline" | "captureTurnBaseline" | "removeWorktreeBaseline"> {
  return {
    ensureWorktreeBaseline: async (threadId, cwd) => {
      await baselines?.ensure(threadId, cwd).catch((error: unknown) => {
        log.write("warn", "baseline", `无法记录会话 ${threadId} 的工作区基线：${String(error)}`)
      })
    },
    captureTurnBaseline: async (threadId, cwd) => {
      await baselines?.captureTurn(threadId, cwd).catch((error: unknown) => {
        log.write("warn", "baseline", `无法记录会话 ${threadId} 的本轮工作区基线：${String(error)}`)
      })
    },
    removeWorktreeBaseline: async (threadId) => {
      await baselines?.remove(threadId).catch((error: unknown) => {
        log.write("warn", "baseline", `无法删除会话 ${threadId} 的工作区基线：${String(error)}`)
      })
    },
  }
}

export interface HandoffWiring {
  journal: Pick<Journal, "flush" | "read">
  /** 引擎 id → 人话名（注册表那份，第三方引擎也在里面）。 */
  labels: Readonly<Record<string, string>>
  log: Logger
  userData: string
  /** 「换引擎自动交接」开着没有。不给＝关着。 */
  enabled: (() => boolean) | undefined
  /** 交接说明与转写的语言。不给＝默认的中文。 */
  locale: (() => Locale) | undefined
}

/** 换引擎交接说明：写不出来就不附（宿主照旧只发用户那句），但要留一笔，不然「为什么这次没交接」无从查起。 */
export function handoffDeps(wiring: HandoffWiring): Pick<HostDeps, "handoffBrief"> {
  const brief = createHandoffBrief({
    journal: wiring.journal,
    enabled: () => wiring.enabled?.() ?? false,
    label: (id) => wiring.labels[id] ?? id,
    spareDir: join(wiring.userData, "handoff"),
    now: () => Date.now(),
    locale: () => wiring.locale?.() ?? DEFAULT_LOCALE,
  })
  return {
    handoffBrief: (thread) => brief(thread).catch((error: unknown) => {
      wiring.log.write("warn", "handoff", `会话 ${thread.id} 的交接说明没写出来：${String(error)}`)
      return undefined
    }),
  }
}
