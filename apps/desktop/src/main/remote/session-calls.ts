import type { CallResult, ClientFrame, ServerFrame } from "@switchback/wire"
import { DEFAULT_LOCALE, type Locale } from "@switchback/i18n"
import { REMOTE_CALLS } from "./session-calls.messages.js"

/**
 * 一条连接上的 `call` → `result`（远程模式，见 `docs/远程模式方案.md`）。
 *
 * 这里只管**配对、限流、回话**：认出一条调用、交给 `call` 去判和做、把结果按 `id` 送回去。
 * 谁能调哪条通道不在这里判——那是 `remote/exposure.ts` 和设备记录的事，
 * 由 `call` 的提供方在调之前做完。
 *
 * 从 `session.ts` 拆出来是行数闸门逼的，但边界也讲得通：那边是**事件流**
 *（有序号、要补洞），这边是**请求与回答**（按 id 配对，丢了由调用方超时重来）。
 */

/**
 * 一条连接上同时在途的调用上限。
 *
 * 桌面界面一次换会话会并发问七八条（分支、审核清单、项目说明…），十六条够宽。
 * 上限挡的是另一件事：一台失控的设备连发几千条「扫一遍活动」，
 * 每一条都要读几十 MB 的 journal——**拖垮的是宿主上正在跑的引擎**。
 */
const MAX_IN_FLIGHT = 16

export type CallOutcome = { ok: true; value?: unknown } | { ok: false; reason: string }

export interface CallsDeps {
  /**
   * 判 + 调一条通道。**没有这一项的连接一律回「不支持」**——
   * 不是静默丢掉：那样客户端只能干等到超时，界面上转很久才说一句含糊的话。
   */
  call?: (method: string, arg: unknown) => Promise<CallOutcome>
  write: (frame: ServerFrame) => void
  /** 回给对端的理由用哪种语言。缺省＝默认的中文。 */
  language?: () => Locale
  log: (level: "info" | "warn" | "error", message: string) => void
}

export interface Calls {
  receive: (frame: Extract<ClientFrame, { type: "call" }>) => void
}

/** `id` 必须是个安全整数，否则回不了话——回话按它配对。 */
function idOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined
}

/** 出错时给人看的那句话。**不带栈**：栈里是宿主上的路径，远程那端用不着，也不该拿到。 */
function reasonOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== "" ? error.message : fallback
}

export function createCalls(deps: CallsDeps): Calls {
  const state = { inFlight: 0 }
  const say = (): (typeof REMOTE_CALLS)[Locale] => REMOTE_CALLS[deps.language?.() ?? DEFAULT_LOCALE]

  const answer = (id: number, outcome: CallOutcome): void => {
    const frame: CallResult = outcome.ok
      ? { type: "result", id, ok: true, value: outcome.value }
      : { type: "result", id, ok: false, reason: outcome.reason }
    deps.write(frame)
  }

  const run = (id: number, method: string, arg: unknown, call: NonNullable<CallsDeps["call"]>): void => {
    state.inFlight += 1
    void call(method, arg)
      .catch((error: unknown): CallOutcome => {
        deps.log("warn", `调用 ${method} 出错：${String(error)}`)
        return { ok: false, reason: reasonOf(error, say().failed) }
      })
      .then((outcome) => {
        state.inFlight -= 1
        answer(id, outcome)
      })
  }

  return {
    receive: (frame) => {
      const id = idOf(frame.id)
      if (id === undefined) {
        // 没有能配对的号就回不了话。**记一笔**：这只可能是客户端写错了
        deps.log("warn", "收到一条没有合法 id 的调用，已丢弃")
        return
      }
      if (typeof frame.method !== "string" || frame.method === "") {
        answer(id, { ok: false, reason: say().noMethod })
        return
      }
      if (deps.call === undefined) {
        answer(id, { ok: false, reason: say().unsupported })
        return
      }
      if (state.inFlight >= MAX_IN_FLIGHT) {
        answer(id, { ok: false, reason: say().tooMany(MAX_IN_FLIGHT) })
        return
      }
      run(id, frame.method, frame.arg, deps.call)
    },
  }
}
