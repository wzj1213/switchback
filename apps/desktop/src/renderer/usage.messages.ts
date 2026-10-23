import { defineMessages } from "@switchback/i18n"

/** 上下文用量那一格。 */
export const USAGE = defineMessages(
  {
    total: (n: string) => `累计 ${n}`,
    cache: (n: string) => `缓存 ${n}`,
    billTotal: (n: string) => ` · 本会话累计 ${n}`,
    billCache: (n: string) => ` · 缓存命中 ${n}`,
    noWindow: (used: number, bill: string) => `上下文占用 ${String(used)} tokens（引擎未提供窗口大小）${bill}`,
    context: (used: string, window: string, pct: string, bill: string) => `上下文 ${used} / ${window} · ${pct}${bill}`,
  },
  {
    total: (n) => `${n} total`,
    cache: (n) => `${n} cached`,
    billTotal: (n) => ` · ${n} in this thread`,
    billCache: (n) => ` · ${n} from cache`,
    noWindow: (used, bill) => `Context: ${String(used)} tokens (the engine didn't report the window size)${bill}`,
    context: (used, window, pct, bill) => `Context ${used} / ${window} · ${pct}${bill}`,
  },
)
