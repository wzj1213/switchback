import type { Event, ThreadId, TurnId } from "@switchback/protocol"
import { CodexActivityTracker } from "./activity.js"
import { createHookTracker, type HookTracker } from "./hooks.js"
import type { Locale } from "@switchback/i18n"

interface ObserverOut {
  threadId: ThreadId
  nativeThread: () => string | undefined
  turnId: () => TurnId | undefined
  emit: (event: Event) => void
  now: () => number
  /** 适配器自己写的话用哪种语言（`StartRequest.locale`）。缺省中文。 */
  locale?: () => Locale
}

export interface CodexObservers {
  activity: CodexActivityTracker
  hooks: HookTracker
}

/** 两类跨通知观察器共用同一份会话身份与时钟。 */
export function createCodexObservers(out: ObserverOut): CodexObservers {
  return {
    activity: new CodexActivityTracker(out),
    hooks: createHookTracker({
      threadId: out.threadId,
      turnId: out.turnId,
      emit: out.emit,
      now: out.now,
      ...(out.locale === undefined ? {} : { locale: out.locale }),
    }),
  }
}
